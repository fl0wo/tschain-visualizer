import { describe, expect, it } from 'vitest';
import { pickWeighted } from '../src/core/consensus/seededRandom';
import { PosChainModel } from '../src/app/model/PosChainModel';

/**
 * The PoS model's contract: blocks are PROPOSED by a stake-weighted,
 * deterministically-seeded validator (no work race), sealed once ≥2/3
 * of total stake has attested, and the proposer collects a small
 * protocol reward plus the block's fees. Users are funded by protocol
 * grants (nobody mines here).
 */
describe('PosChainModel', () => {
	const instant = { proposeMs: 0, attestMs: 0 };

	it('selects the proposer deterministically and verifiably from the seed', async () => {
		// Identical chain state (the fixed genesis) ⇒ identical seed ⇒
		// identical proposer across independent instances…
		const a = new PosChainModel(instant);
		const b = new PosChainModel(instant);
		let proposerA = '';
		let proposerB = '';
		let publishedSeed = '';
		a.events.on('pos:slot', (p) => {
			proposerA = p.proposerName;
			publishedSeed = p.seed;
		});
		b.events.on('pos:slot', (p) => (proposerB = p.proposerName));
		await a.produceSlot();
		await b.produceSlot();
		expect(proposerA).toBe(proposerB);

		// …and the HUD-published seed alone is enough for ANYONE to verify
		// the stake-weighted selection — unpredictable before, checkable
		// after, which is the whole point of seeded randomness.
		const verified = pickWeighted(a.validators, publishedSeed.slice(2));
		expect(verified.name).toBe(proposerA);
	});

	it('seals a block only after ≥2/3 of total stake attested', async () => {
		const model = new PosChainModel(instant);
		const attestations: Array<{ collectedStake: number; neededStake: number; totalStake: number }> = [];
		model.events.on('pos:attestation', (p) => attestations.push(p));

		await model.produceSlot();
		const last = attestations[attestations.length - 1]!;
		expect(last.neededStake).toBe(Math.ceil((last.totalStake * 2) / 3));
		expect(last.collectedStake).toBeGreaterThanOrEqual(last.neededStake);
	});

	it('pays the proposer the protocol reward plus the block fees', async () => {
		const model = new PosChainModel(instant);
		model.createWallet('Alice');
		model.createWallet('Bob');
		await model.produceSlot(); // delivers the faucet grants

		model.submitTransaction('Alice', 'Bob', 10, 3); // fee 3
		let proposer = '';
		model.events.on('pos:slot', (p) => (proposer = p.proposerName));
		await model.produceSlot();

		const winner = model.validators.find((v) => v.name === proposer)!;
		// proposer reward (2) + fees (3); attesters earn 1 each
		expect(winner.earned).toBeGreaterThanOrEqual(2 + 3);
		// rewards are real on-chain coins, not panel decoration
		expect(model.getBalance(winner.address)).toBe(winner.earned);
	});

	it('funds new wallets with a protocol grant in the next block', async () => {
		const model = new PosChainModel(instant);
		model.createWallet('Alice');
		expect(model.balances.find((w) => w.name === 'Alice')!.balance).toBe(0);

		let block: { transactions: readonly { coinbase: boolean; toName: string }[] } | null = null;
		model.events.on('block:mined', (b) => (block = b));
		await model.produceSlot();

		expect(model.balances.find((w) => w.name === 'Alice')!.balance).toBe(100);
		// the grant is a visible protocol (from-null) transaction
		expect(block!.transactions.some((tx) => tx.coinbase && tx.toName === 'Alice')).toBe(true);
	});

	it('moves user payments through the mempool into slot blocks', async () => {
		const model = new PosChainModel(instant);
		model.createWallet('Alice');
		model.createWallet('Bob');
		await model.produceSlot();

		expect(model.submitTransaction('Alice', 'Bob', 25, 1)).toBe(true);
		expect(model.pendingTransactions).toHaveLength(1);
		await model.produceSlot();
		expect(model.pendingTransactions).toHaveLength(0);
		expect(model.balances.find((w) => w.name === 'Bob')!.balance).toBe(125);
		expect(model.balances.find((w) => w.name === 'Alice')!.balance).toBe(100 - 26);
	});
});
