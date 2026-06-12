import { describe, it, expect } from 'vitest';
import { Block } from '../src/core/Block';
import { Blockchain } from '../src/core/Blockchain';
import { Transaction } from '../src/core/Transaction';
import { Wallet } from '../src/core/Wallet';

/**
 * The blockchain is a tamper-EVIDENT (not tamper-PROOF) structure: you
 * can rewrite a block in memory, but every check downstream of it breaks
 * loudly. These tests walk that story:
 *
 *  - a well-formed chain validates;
 *  - editing history invalidates the chain;
 *  - even RE-MINING the edited block doesn't help, because its new hash
 *    no longer matches what the next block recorded as `previousHash`.
 */
describe('Blockchain', () => {
	const DIFFICULTY = 2;

	/** Builds a chain with one mined block containing one signed tx. */
	async function chainWithOneBlock() {
		const chain = new Blockchain(DIFFICULTY);
		const alice = new Wallet();
		const bob = new Wallet();
		const tx = new Transaction({
			from: alice.address,
			to: bob.address,
			amount: 30,
			nonce: 0,
			timestamp: 1_700_000_001_000,
		});
		alice.sign(tx);

		const block = new Block({
			index: 1,
			timestamp: 1_700_000_002_000,
			transactions: [tx],
			previousHash: chain.latestBlock.hash,
		});
		await block.mine(DIFFICULTY);
		chain.addBlock(block);
		return { chain, alice, bob, tx, block };
	}

	it('starts with a genesis block', () => {
		const chain = new Blockchain(DIFFICULTY);
		expect(chain.blocks).toHaveLength(1);
		const genesis = chain.blocks[0]!;
		expect(genesis.index).toBe(0);
		// Genesis has no parent; by convention its previousHash is all zeros.
		expect(genesis.previousHash).toBe('0'.repeat(64));
	});

	it('accepts a valid mined block and rejects bad linkage/PoW', async () => {
		const { chain } = await chainWithOneBlock();
		expect(chain.blocks).toHaveLength(2);

		// Wrong previousHash → reject.
		const orphan = new Block({
			index: 2,
			timestamp: 1_700_000_003_000,
			transactions: [],
			previousHash: 'ab'.repeat(32),
		});
		await orphan.mine(DIFFICULTY);
		expect(() => chain.addBlock(orphan)).toThrow(/previousHash/i);

		// Correct linkage but no proof-of-work → reject.
		const lazy = new Block({
			index: 2,
			timestamp: 1_700_000_003_000,
			transactions: [],
			previousHash: chain.latestBlock.hash,
		});
		// not mined — hash almost certainly fails the difficulty target
		expect(() => chain.addBlock(lazy)).toThrow(/proof-of-work|difficulty/i);
	});

	it('validates an untampered chain', async () => {
		const { chain } = await chainWithOneBlock();
		expect(chain.isChainValid()).toBe(true);
	});

	it('detects a tampered transaction in an old block', async () => {
		const { chain, alice, bob, block } = await chainWithOneBlock();

		// Rewrite history: bump the amount in the already-mined block.
		block.transactions[0] = new Transaction({
			from: alice.address,
			to: bob.address,
			amount: 999_999,
			nonce: 0,
			timestamp: 1_700_000_001_000,
			signature: block.transactions[0]!.signature, // keep the old sig
		});
		expect(chain.isChainValid()).toBe(false);
	});

	it('still fails after re-mining the tampered block (broken linkage)', async () => {
		const { chain, alice, bob, block } = await chainWithOneBlock();

		// Add a SECOND block on top, so the tampered block has a child
		// that recorded its original hash.
		const next = new Block({
			index: 2,
			timestamp: 1_700_000_004_000,
			transactions: [],
			previousHash: chain.latestBlock.hash,
		});
		await next.mine(DIFFICULTY);
		chain.addBlock(next);

		// Tamper with block 1, then re-mine it so its own hash + PoW are
		// self-consistent again. Signature stays valid (alice re-signs).
		const evil = new Transaction({
			from: alice.address,
			to: bob.address,
			amount: 999_999,
			nonce: 0,
			timestamp: 1_700_000_001_000,
		});
		alice.sign(evil);
		block.transactions[0] = evil;
		await block.mine(DIFFICULTY);

		// Block 1 is now internally consistent — but block 2 still points
		// at block 1's OLD hash. To truly rewrite history you'd have to
		// re-mine every later block too: that cascade is the whole defense.
		expect(chain.isChainValid()).toBe(false);
	});

	it('counts confirmations as depth below the chain tip', async () => {
		const { chain, tx } = await chainWithOneBlock();
		// The tx's block IS the tip → 1 confirmation.
		expect(chain.getConfirmations(tx.hash())).toBe(1);

		// Bury it under one more block → 2 confirmations. Each block on
		// top is one more proof-of-work an attacker would have to redo to
		// rewrite this payment out of history.
		const next = new Block({
			index: 2,
			timestamp: 1_700_000_006_000,
			transactions: [],
			previousHash: chain.latestBlock.hash,
		});
		await next.mine(DIFFICULTY);
		chain.addBlock(next);
		expect(chain.getConfirmations(tx.hash())).toBe(2);

		// Unknown hash → 0 confirmations (not on-chain at all).
		expect(chain.getConfirmations('ff'.repeat(32))).toBe(0);
	});

	it('derives balances and nonces by replaying the chain', async () => {
		const { chain, alice, bob } = await chainWithOneBlock();
		// Alice sent 30 to Bob (she's allowed to go negative here — balance
		// enforcement is the Mempool's job at submission time, not the
		// ledger's job after the fact).
		expect(chain.getBalance(bob.address)).toBe(30);
		expect(chain.getBalance(alice.address)).toBe(-30);
		// Alice has one mined tx, so her next expected nonce is 1.
		expect(chain.getNonce(alice.address)).toBe(1);
		expect(chain.getNonce(bob.address)).toBe(0);
	});
});
