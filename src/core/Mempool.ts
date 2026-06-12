import { Block } from './Block';
import type { MineOptions } from './Block';
import type { Blockchain } from './Blockchain';
import { Transaction } from './Transaction';
import { Wallet } from './Wallet';
import type { Address } from './types';

/** Coins minted per block as the miner's reward. */
export const MINING_REWARD = 100;

/**
 * # Mempool
 *
 * The waiting room for transactions that are signed and broadcast but not
 * yet mined — and, crucially, the **gatekeeper against double-spending**.
 *
 * A signature only proves "the owner authorized this transfer". It does
 * NOT prove the money exists or hasn't already been promised elsewhere.
 * An owner can happily sign two transactions that each spend their whole
 * balance — both signatures verify! Someone has to look at *state*
 * (current balance, already-pending spends, expected nonce) and refuse
 * the second one. In a real network every node runs these checks; here,
 * the mempool does.
 */
export class Mempool {
	/** Validated transactions waiting to be mined, in arrival order. */
	readonly pending: Transaction[] = [];

	constructor(private readonly chain: Blockchain) {}

	/**
	 * The full admission pipeline. Checks run from cheapest to most
	 * stateful, and each failure names exactly which rule was broken —
	 * "invalid transaction" teaches nobody anything.
	 *
	 *   1. shape    — coinbase txs can't be submitted (only mining mints)
	 *   2. signature — was this really authorized by `from`?
	 *   3. balance  — does the sender have the funds, COUNTING the spends
	 *                 already sitting in the pool? (double-spend check)
	 *   4. nonce    — is this the sender's next transaction in sequence?
	 *                 (replay + ordering check)
	 */
	addTransaction(tx: Transaction): void {
		// (1) Nobody gets to mint coins by just asking.
		if (tx.from === null) {
			throw new Error('Rejected: coinbase transactions are created by mining, not submitted');
		}

		// (2) Authorization. Recomputes the hash, so this also catches
		// any field tampered with after signing.
		if (!Wallet.verify(tx)) {
			throw new Error('Rejected: invalid signature — transaction not authorized by sender');
		}

		if (tx.amount <= 0) {
			throw new Error('Rejected: amount must be positive');
		}

		// (3) Funds check — the heart of double-spend prevention.
		// On-chain balance minus what this sender has ALREADY queued in
		// the pool: pending spends reserve funds even before mining.
		const pendingSpend = this.pending
			.filter((p) => p.from === tx.from)
			.reduce((sum, p) => sum + p.amount, 0);
		const available = this.chain.getBalance(tx.from) - pendingSpend;
		if (tx.amount > available) {
			throw new Error(
				`Rejected: insufficient balance — needs ${tx.amount}, ` +
					`but only ${available} available (${pendingSpend} already pending)`,
			);
		}

		// (4) Nonce check — kills replays and gaps. The expected nonce is
		// (txs already mined from this sender) + (txs already pending).
		// A replayed tx re-uses an old nonce → rejected. A gap would let
		// a replay slot in later → also rejected.
		const expectedNonce = this.chain.getNonce(tx.from) + this.pending.filter((p) => p.from === tx.from).length;
		if (tx.nonce !== expectedNonce) {
			throw new Error(
				`Rejected: bad nonce — expected ${expectedNonce}, got ${tx.nonce} ` +
					`(already used or out of sequence)`,
			);
		}

		this.pending.push(tx);
	}

	/**
	 * Turns the pending pool into a mined block:
	 * take the queued transactions, append one coinbase paying the miner
	 * (this is where new coins come from — and why miners mine), do the
	 * proof-of-work, append to the chain, and clear what was mined.
	 */
	async minePendingTransactions(
		minerAddress: Address,
		options: MineOptions = {},
	): Promise<Block> {
		const reward = new Transaction({
			from: null, // coinbase: minted, not sent
			to: minerAddress,
			amount: MINING_REWARD,
			nonce: 0,
			timestamp: Date.now(),
		});
		const transactions = [...this.pending, reward];

		const block = new Block({
			index: this.chain.latestBlock.index + 1,
			timestamp: Date.now(),
			transactions,
			previousHash: this.chain.latestBlock.hash,
		});
		await block.mine(this.chain.difficulty, options);
		this.chain.addBlock(block);

		// Only now is it safe to drop them from the pool: they're history.
		this.pending.length = 0;
		return block;
	}
}
