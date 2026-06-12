import { describe, it, expect } from 'vitest';
import { Transaction } from '../src/core/Transaction';

/**
 * A transaction's hash is its identity. These tests pin down the two
 * properties that make signatures possible at all:
 *
 *  1. Determinism — the same data must ALWAYS produce the same hash,
 *     otherwise a signature made on one machine wouldn't verify on another.
 *  2. Sensitivity — changing ANY field must change the hash, otherwise
 *     an attacker could alter a signed transaction without invalidating
 *     the signature.
 */
describe('Transaction', () => {
	// Fixed inputs so hashes are reproducible across test runs.
	const base = {
		from: 'aa'.repeat(32), // 32-byte hex public key
		to: 'bb'.repeat(32),
		amount: 50,
		nonce: 0,
		timestamp: 1_700_000_000_000,
	};

	it('produces the same hash for the same data (determinism)', () => {
		const tx1 = new Transaction(base);
		const tx2 = new Transaction({ ...base });
		expect(tx1.hash()).toBe(tx2.hash());
		// SHA-256 → 32 bytes → 64 hex chars.
		expect(tx1.hash()).toMatch(/^[0-9a-f]{64}$/);
	});

	it('changes the hash when any field changes (sensitivity)', () => {
		const original = new Transaction(base).hash();
		const variants = [
			new Transaction({ ...base, from: 'cc'.repeat(32) }),
			new Transaction({ ...base, to: 'cc'.repeat(32) }),
			new Transaction({ ...base, amount: 51 }),
			new Transaction({ ...base, nonce: 1 }),
			new Transaction({ ...base, timestamp: base.timestamp + 1 }),
		];
		for (const variant of variants) {
			expect(variant.hash()).not.toBe(original);
		}
	});

	it('includes the fee in the hash, defaulting to zero', () => {
		// The fee is part of what the sender authorizes — if it weren't
		// hashed (and therefore signed), a miner could quietly raise it.
		const free = new Transaction(base);
		const paid = new Transaction({ ...base, fee: 2 });
		expect(free.fee).toBe(0);
		expect(paid.fee).toBe(2);
		expect(paid.hash()).not.toBe(free.hash());
	});

	it('includes kind and memo in the hash, with neutral defaults', () => {
		// Settlement transactions (channel funding, rollup batches…) are
		// labeled by `kind` and may carry data in `memo` — both must be
		// covered by the signature, or a miner could relabel/strip them.
		const plain = new Transaction(base);
		expect(plain.kind).toBe('transfer');
		expect(plain.memo).toBe('');
		const labeled = new Transaction({ ...base, kind: 'channel-open' });
		const withMemo = new Transaction({ ...base, memo: 'state:42' });
		expect(labeled.hash()).not.toBe(plain.hash());
		expect(withMemo.hash()).not.toBe(plain.hash());
	});

	it('excludes the signature from the hash', () => {
		// The signature signs the hash, so the hash cannot include the
		// signature — that would be circular. Attaching a signature must
		// therefore leave the hash unchanged.
		const unsigned = new Transaction(base);
		const signed = new Transaction({ ...base, signature: 'ff'.repeat(64) });
		expect(signed.hash()).toBe(unsigned.hash());
	});

	it('supports coinbase transactions with from = null', () => {
		// Coinbase txs mint new coins as a mining reward — there is no
		// sender, so there is nobody to sign them. `from: null` marks that.
		const coinbase = new Transaction({
			from: null,
			to: base.to,
			amount: 100,
			nonce: 0,
			timestamp: base.timestamp,
		});
		expect(coinbase.isCoinbase()).toBe(true);
		expect(coinbase.hash()).toMatch(/^[0-9a-f]{64}$/);

		const regular = new Transaction(base);
		expect(regular.isCoinbase()).toBe(false);
	});
});
