import { Block } from '../../core/Block';
import { Blockchain } from '../../core/Blockchain';
import { Mempool } from '../../core/Mempool';
import { Transaction } from '../../core/Transaction';
import { Wallet } from '../../core/Wallet';
import { pickWeighted, slotSeed } from '../../core/consensus/seededRandom';
import { TypedEventEmitter } from '../../core/events';
import type {
	BlockInfo,
	ChainEvents,
	TxInfo,
	ValidationReport,
	ValidatorInfo,
} from '../../core/events/chainEvents';
import type { Address, Hex } from '../../core/types';

/** Wall-clock pacing of a slot's phases (0s in tests). */
export interface PosPace {
	/** pause after announcing the proposer, before attestations */
	proposeMs: number;
	/** pause between individual attestation votes */
	attestMs: number;
}

const PROPOSER_REWARD = 2;
const ATTESTER_REWARD = 1;
const FAUCET_GRANT = 100;
const SLOTS_PER_EPOCH = 8;

/**
 * # PosChainModel — proof of stake on the same chain core
 *
 * The PoW page's economy, with consensus swapped: nobody searches for
 * nonces. Each slot the protocol pseudo-randomly selects ONE proposer,
 * weighted by stake (seed = sha256(slot | parent hash) — deterministic,
 * verifiable, shown in the HUD), a committee of the other validators
 * attests, and the block seals once ≥2/3 of total stake has voted.
 * Rewards are small (proposer + attesters + the block's fees) because
 * no electricity was burned. Users are funded by protocol grants — the
 * faucet — since there is no coinbase lottery to win.
 *
 * Deliberately simplified (and the page says so): attestations are
 * simulated votes rather than carried signatures, every validator is
 * honest (no slashing), and finality checkpoints are not modeled —
 * those belong to the full consensus-engine refactor
 * (docs/design/phase-a-consensus.md).
 */
export class PosChainModel {
	readonly events = new TypedEventEmitter<ChainEvents>();
	private readonly chain: Blockchain;
	private readonly mempool: Mempool;
	private readonly wallets = new Map<string, Wallet>();
	private readonly validatorSet: Array<{ name: string; wallet: Wallet; stake: number; earned: number }>;
	/** wallets waiting for their faucet grant in the next block */
	private readonly pendingGrants: Address[] = [];
	private slot = 0;

	constructor(
		private readonly pace: PosPace = { proposeMs: 600, attestMs: 320 },
		stakes: readonly number[] = [32, 48, 64, 32, 16],
	) {
		// difficulty 0: blocks need no proof-of-work — validity comes from
		// the (simulated) attestation supermajority instead
		this.chain = new Blockchain(0);
		this.mempool = new Mempool(this.chain);
		this.validatorSet = stakes.map((stake, i) => ({
			name: `Validator ${String.fromCharCode(65 + i)}`,
			wallet: new Wallet(),
			stake,
			earned: 0,
		}));
	}

	get validators(): ValidatorInfo[] {
		return this.validatorSet.map(({ name, wallet, stake, earned }) => ({
			name,
			address: wallet.address,
			stake,
			earned,
		}));
	}

	// ── users (same economy as the PoW page) ──────────────────────────

	createWallet(name: string): { name: string; address: Address } {
		if (this.wallets.has(name)) throw new Error(`Wallet "${name}" already exists`);
		const wallet = new Wallet();
		this.wallets.set(name, wallet);
		// no mining to bootstrap an economy here: the protocol grants
		// starter funds, delivered inside the NEXT slot's block
		this.pendingGrants.push(wallet.address);
		const info = { name, address: wallet.address };
		this.events.emit('wallet:created', info);
		return info;
	}

	get walletNames(): string[] {
		return [...this.wallets.keys()];
	}

	get balances(): Array<{ name: string; address: Address; balance: number }> {
		return [...this.wallets.entries()].map(([name, wallet]) => ({
			name,
			address: wallet.address,
			balance: this.chain.getBalance(wallet.address),
		}));
	}

	getBalance(address: Address): number {
		return this.chain.getBalance(address);
	}

	getConfirmations(txHash: Hex): number {
		return this.chain.getConfirmations(txHash);
	}

	submitTransaction(fromName: string, toName: string, amount: number, fee = 0): boolean {
		const from = this.requireWallet(fromName);
		const to = this.requireWallet(toName);
		const pendingFromSender = this.mempool.pending.filter((tx) => tx.from === from.address).length;
		const tx = new Transaction({
			from: from.address,
			to: to.address,
			amount,
			fee,
			nonce: this.chain.getNonce(from.address) + pendingFromSender,
			timestamp: Date.now(),
		});
		from.sign(tx);
		try {
			this.mempool.addTransaction(tx);
		} catch (error) {
			this.events.emit('tx:rejected', {
				reason: (error as Error).message,
				fromName,
				toName,
				amount,
			});
			return false;
		}
		this.events.emit('tx:added', this.toTxInfo(tx));
		return true;
	}

	get pendingTransactions(): TxInfo[] {
		return this.mempool.pending.map((tx) => this.toTxInfo(tx));
	}

	get blocks(): BlockInfo[] {
		return this.chain.blocks.map((_, i) => this.toBlockInfo(i));
	}

	// ── the slot: select → attest → seal ──────────────────────────────

	/**
	 * One slot of PoS life. Unlike mining, this runs on a CLOCK: a block
	 * is produced whether or not transactions are waiting — empty blocks
	 * are normal in PoS, the chain's heartbeat never depends on fees.
	 */
	async produceSlot(): Promise<BlockInfo> {
		this.slot++;
		const index = this.chain.latestBlock.index + 1;
		const seed = slotSeed(this.slot, this.chain.latestBlock.hash);
		const proposer = pickWeighted(this.validatorSet, seed);
		this.events.emit('pos:slot', {
			slot: this.slot,
			epoch: Math.floor(this.slot / SLOTS_PER_EPOCH),
			index,
			proposerName: proposer.name,
			seed: `0x${seed.slice(0, 8)}`,
		});
		await this.wait(this.pace.proposeMs);

		// Attestation: the committee (everyone else) votes, stake-weighted.
		// Simplification disclosed in the class doc: simulated votes, all
		// honest. The ≥2/3 threshold is the real Casper/Tendermint number.
		const totalStake = this.validatorSet.reduce((sum, v) => sum + v.stake, 0);
		const neededStake = Math.ceil((totalStake * 2) / 3);
		let collectedStake = proposer.stake; // the proposer backs its own block
		const attesters: typeof this.validatorSet = [];
		for (const validator of this.validatorSet) {
			if (validator === proposer) continue;
			await this.wait(this.pace.attestMs);
			collectedStake += validator.stake;
			attesters.push(validator);
			this.events.emit('pos:attestation', {
				validatorName: validator.name,
				collectedStake,
				neededStake,
				totalStake,
			});
		}

		// Seal: user batch + faucet grants + protocol rewards.
		const batch = [...this.mempool.pending];
		const fees = batch.reduce((sum, tx) => sum + tx.fee, 0);
		const now = Date.now();
		const grants = this.pendingGrants.splice(0).map(
			(address) =>
				new Transaction({ from: null, to: address, amount: FAUCET_GRANT, nonce: 0, timestamp: now }),
		);
		const rewards = [
			new Transaction({
				from: null,
				to: proposer.wallet.address,
				amount: PROPOSER_REWARD + fees,
				nonce: 0,
				timestamp: now,
			}),
			...attesters.map(
				(v) =>
					new Transaction({
						from: null,
						to: v.wallet.address,
						amount: ATTESTER_REWARD,
						nonce: 0,
						timestamp: now,
					}),
			),
		];

		const block = new Block({
			index,
			timestamp: now,
			transactions: [...batch, ...grants, ...rewards],
			previousHash: this.chain.latestBlock.hash,
		});
		this.chain.addBlock(block); // difficulty 0: no nonce search needed

		// prune exactly the mined batch (txs that arrived mid-slot stay)
		const mined = new Set(batch);
		this.mempool.pending.splice(
			0,
			this.mempool.pending.length,
			...this.mempool.pending.filter((tx) => !mined.has(tx)),
		);

		proposer.earned += PROPOSER_REWARD + fees;
		for (const v of attesters) v.earned += ATTESTER_REWARD;
		this.events.emit('stake:changed', { validators: this.validators });

		const info = this.toBlockInfo(block.index);
		this.events.emit('block:mined', info);
		return info;
	}

	validateChain(): ValidationReport {
		const blocks = this.chain.blocks.map((block, i) => {
			const parent = i > 0 ? this.chain.blocks[i - 1]! : null;
			return {
				index: block.index,
				hashValid: block.hash === block.calculateHash(),
				linkValid: parent === null || block.previousHash === parent.calculateHash(),
				powValid: true, // stake, not work, secures this chain
				signaturesValid: block.transactions.every((tx) => tx.isCoinbase() || Wallet.verify(tx)),
			};
		});
		const report: ValidationReport = { valid: this.chain.isChainValid(), blocks };
		this.events.emit('chain:validated', report);
		return report;
	}

	// ── helpers ────────────────────────────────────────────────────────

	private wait(ms: number): Promise<void> {
		return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
	}

	private requireWallet(name: string): Wallet {
		const wallet = this.wallets.get(name);
		if (!wallet) throw new Error(`Unknown wallet "${name}"`);
		return wallet;
	}

	private nameOf(address: Address | null): string {
		if (address === null) return 'protocol';
		for (const [name, wallet] of this.wallets) if (wallet.address === address) return name;
		for (const v of this.validatorSet) if (v.wallet.address === address) return v.name;
		return `${address.slice(0, 8)}…`;
	}

	private toTxInfo(tx: Transaction): TxInfo {
		return {
			hash: tx.hash(),
			from: tx.from,
			to: tx.to,
			fromName: this.nameOf(tx.from),
			toName: this.nameOf(tx.to),
			amount: tx.amount,
			fee: tx.fee,
			nonce: tx.nonce,
			coinbase: tx.isCoinbase(),
			signatureValid: tx.isCoinbase() ? true : Wallet.verify(tx),
		};
	}

	private toBlockInfo(index: number): BlockInfo {
		const block = this.chain.blocks[index];
		if (!block) throw new Error(`No block #${index}`);
		return {
			index: block.index,
			hash: block.hash,
			previousHash: block.previousHash,
			nonce: block.nonce,
			timestamp: block.timestamp,
			transactions: block.transactions.map((tx) => this.toTxInfo(tx)),
		};
	}
}
