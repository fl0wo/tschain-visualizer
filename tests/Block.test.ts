import { describe, it, expect } from 'vitest';
import { Block } from '../src/core/Block';
import { Transaction } from '../src/core/Transaction';

/**
 * A block bundles transactions and seals them with proof-of-work.
 * Two properties under test:
 *
 *  1. Mining finds a nonce whose hash meets the difficulty target —
 *     expensive to produce, trivial to check.
 *  2. The stored hash commits to the block's contents: change anything
 *     inside and the stored hash no longer matches a recomputation.
 */
describe('Block', () => {
	const makeTx = () =>
		new Transaction({
			from: 'aa'.repeat(32),
			to: 'bb'.repeat(32),
			amount: 10,
			nonce: 0,
			timestamp: 1_700_000_000_000,
		});

	const makeBlock = () =>
		new Block({
			index: 1,
			timestamp: 1_700_000_000_500,
			transactions: [makeTx()],
			previousHash: '00'.repeat(32),
		});

	it('calculates a deterministic SHA-256 hash over its contents', () => {
		const a = makeBlock();
		const b = makeBlock();
		expect(a.calculateHash()).toBe(b.calculateHash());
		expect(a.calculateHash()).toMatch(/^[0-9a-f]{64}$/);
	});

	it('mining produces a hash meeting the difficulty target', async () => {
		const block = makeBlock();
		await block.mine(2);
		// Difficulty 2 = hash must start with two zeros. Easy enough for a
		// test, but the principle scales: each extra zero is 16x the work.
		expect(block.hash.startsWith('00')).toBe(true);
		// The stored hash must be the real hash of the final nonce.
		expect(block.hash).toBe(block.calculateHash());
	});

	it('different nonces produce different hashes (what mining exploits)', () => {
		const block = makeBlock();
		const h0 = block.calculateHash();
		block.nonce = 1;
		expect(block.calculateHash()).not.toBe(h0);
	});

	it('tampering with a transaction invalidates the stored hash', async () => {
		const block = makeBlock();
		await block.mine(2);

		// Swap in a transaction with a different amount — simulating an
		// attacker editing history. The stored (mined) hash was computed
		// over the OLD contents, so recomputing must now disagree.
		block.transactions[0] = new Transaction({
			from: 'aa'.repeat(32),
			to: 'bb'.repeat(32),
			amount: 999_999,
			nonce: 0,
			timestamp: 1_700_000_000_000,
		});
		expect(block.calculateHash()).not.toBe(block.hash);
	});

	it('reports mining progress so a UI can animate the search', async () => {
		const block = makeBlock();
		const seen: number[] = [];
		await block.mine(1, {
			yieldEvery: 4,
			onProgress: (nonce, hashAttempt) => {
				seen.push(nonce);
				expect(hashAttempt).toMatch(/^[0-9a-f]{64}$/);
			},
		});
		// Progress fires at least once: at minimum for the final result.
		expect(seen.length).toBeGreaterThan(0);
	});
});
