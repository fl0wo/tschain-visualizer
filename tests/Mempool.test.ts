import { describe, it, expect } from 'vitest';
import { Blockchain } from '../src/core/Blockchain';
import { Mempool, MINING_REWARD } from '../src/core/Mempool';
import { Transaction } from '../src/core/Transaction';
import { Wallet } from '../src/core/Wallet';

/**
 * The mempool is the gatekeeper between "someone broadcast a transaction"
 * and "it gets mined into history". These are the tests that earn the
 * word *currency*: without them, valid signatures could still spend the
 * same coin twice, replay old payments, or spend money that isn't there.
 */
describe('Mempool', () => {
	/** Fresh chain + mempool, with `amount` mined to a funded wallet. */
	async function setup() {
		const chain = new Blockchain(1); // low difficulty: fast tests
		const pool = new Mempool(chain);
		const alice = new Wallet();
		const bob = new Wallet();
		// Fund alice by letting her "mine" an empty block → coinbase reward.
		await pool.minePendingTransactions(alice.address);
		expect(chain.getBalance(alice.address)).toBe(MINING_REWARD);
		return { chain, pool, alice, bob };
	}

	function signedTx(wallet: Wallet, to: string, amount: number, nonce: number) {
		const tx = new Transaction({
			from: wallet.address,
			to,
			amount,
			nonce,
			timestamp: 1_700_000_005_000,
		});
		wallet.sign(tx);
		return tx;
	}

	it('accepts a valid signed transaction', async () => {
		const { pool, alice, bob } = await setup();
		pool.addTransaction(signedTx(alice, bob.address, 40, 0));
		expect(pool.pending).toHaveLength(1);
	});

	it('rejects an unsigned or badly signed transaction', async () => {
		const { pool, alice, bob } = await setup();
		const unsigned = new Transaction({
			from: alice.address,
			to: bob.address,
			amount: 1,
			nonce: 0,
			timestamp: 1_700_000_005_000,
		});
		expect(() => pool.addTransaction(unsigned)).toThrow(/signature/i);
	});

	it('rejects an overdraft even with a perfectly valid signature', async () => {
		const { pool, alice, bob } = await setup();
		// Alice owns MINING_REWARD. Signature math doesn't know balances —
		// this signs fine. The mempool must still refuse it.
		const tooMuch = signedTx(alice, bob.address, MINING_REWARD + 1, 0);
		expect(() => pool.addTransaction(tooMuch)).toThrow(/balance|funds/i);
	});

	it('rejects a double-spend already pending in the pool', async () => {
		const { pool, alice, bob } = await setup();
		// Both txs are individually affordable and correctly signed —
		// but TOGETHER they spend more than alice has. The second must be
		// rejected because the first already reserved the funds.
		pool.addTransaction(signedTx(alice, bob.address, 80, 0));
		const doubleSpend = signedTx(alice, bob.address, 80, 1);
		expect(() => pool.addTransaction(doubleSpend)).toThrow(/balance|funds/i);
	});

	it('rejects a replayed (already mined) transaction by its nonce', async () => {
		const { pool, alice, bob } = await setup();
		const tx = signedTx(alice, bob.address, 10, 0);
		pool.addTransaction(tx);
		await pool.minePendingTransactions(bob.address);

		// Re-broadcasting the identical signed tx: the signature is still
		// valid (nothing changed!) — only the nonce check stops Bob from
		// "cashing" alice's payment twice.
		expect(() => pool.addTransaction(tx)).toThrow(/nonce/i);
	});

	it('rejects a transaction with a gap in the nonce sequence', async () => {
		const { pool, alice, bob } = await setup();
		// Next expected nonce is 0; submitting 5 would let later replays
		// slip in between, so the sequence must be dense.
		expect(() => pool.addTransaction(signedTx(alice, bob.address, 1, 5))).toThrow(/nonce/i);
	});

	it('does not drop transactions submitted while mining is in progress', async () => {
		const { chain, pool, alice, bob } = await setup();
		pool.addTransaction(signedTx(alice, bob.address, 10, 0));

		// Mining yields to the event loop between hash attempts, so in a
		// live app new transactions arrive mid-mine. They are NOT part of
		// the block being mined — they must survive into the next one,
		// not be wiped when the pool clears the mined batch.
		chain.difficulty = 2; // enough attempts that we reliably interleave
		const minePromise = pool.minePendingTransactions(bob.address, { yieldEvery: 1 });
		await new Promise((resolve) => setTimeout(resolve, 0)); // let mining start
		pool.addTransaction(signedTx(alice, bob.address, 5, 1));
		const block = await minePromise;

		// The block holds the first tx + coinbase; the late tx still waits.
		expect(block.transactions).toHaveLength(2);
		expect(pool.pending).toHaveLength(1);
		expect(pool.pending[0]!.amount).toBe(5);
	});

	it('mines pending txs into a block with a coinbase reward, then clears them', async () => {
		const { chain, pool, alice, bob } = await setup();
		const miner = new Wallet();
		pool.addTransaction(signedTx(alice, bob.address, 25, 0));

		const block = await pool.minePendingTransactions(miner.address);

		// The mined block holds the payment + one coinbase for the miner.
		expect(block.transactions).toHaveLength(2);
		expect(block.transactions.some((tx) => tx.isCoinbase())).toBe(true);
		expect(pool.pending).toHaveLength(0);
		expect(chain.getBalance(bob.address)).toBe(25);
		expect(chain.getBalance(alice.address)).toBe(MINING_REWARD - 25);
		expect(chain.getBalance(miner.address)).toBe(MINING_REWARD);
	});
});
