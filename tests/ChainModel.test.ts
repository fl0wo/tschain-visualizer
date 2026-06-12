import { describe, it, expect } from 'vitest';
import { ChainModel } from '../src/app/model/ChainModel';
import { MINING_REWARD } from '../src/core/Mempool';

/**
 * ChainModel is the Model of the MVC app: it wraps Blockchain + Mempool
 * and turns every outcome — good or bad — into a typed event. The View
 * never calls the core directly; it only reacts to these events. So the
 * contract under test is: every action emits the right announcement.
 */
describe('ChainModel', () => {
	function record<T>(events: T[]) {
		return (payload: T) => events.push(payload);
	}

	it('creates named wallets and announces them', () => {
		const model = new ChainModel(1);
		const created: Array<{ name: string; address: string }> = [];
		model.events.on('wallet:created', record(created));

		const alice = model.createWallet('Alice');
		expect(alice.address).toMatch(/^[0-9a-f]{64}$/);
		expect(created).toEqual([{ name: 'Alice', address: alice.address }]);
		expect(model.walletNames).toEqual(['Alice']);
	});

	it('mines a block and announces it with progress along the way', async () => {
		const model = new ChainModel(1);
		const alice = model.createWallet('Alice');
		const mined: Array<{ index: number }> = [];
		model.events.on('block:mined', (p) => mined.push({ index: p.index }));

		await model.mine('Alice');
		expect(mined).toEqual([{ index: 1 }]);
		expect(model.getBalance(alice.address)).toBe(MINING_REWARD);
	});

	it('accepts a valid payment and announces tx:added', async () => {
		const model = new ChainModel(1);
		model.createWallet('Alice');
		model.createWallet('Bob');
		await model.mine('Alice');

		const added: Array<{ from: string; amount: number }> = [];
		model.events.on('tx:added', (p) => added.push({ from: p.fromName, amount: p.amount }));

		model.submitTransaction('Alice', 'Bob', 25);
		expect(added).toEqual([{ from: 'Alice', amount: 25 }]);
		expect(model.pendingTransactions).toHaveLength(1);
	});

	it('announces tx:rejected with the reason instead of throwing at the UI', async () => {
		const model = new ChainModel(1);
		model.createWallet('Alice');
		model.createWallet('Bob');
		// No mining: Alice owns nothing, so any spend is an overdraft.
		const rejections: string[] = [];
		model.events.on('tx:rejected', (p) => rejections.push(p.reason));

		model.submitTransaction('Alice', 'Bob', 10);
		expect(rejections).toHaveLength(1);
		expect(rejections[0]).toMatch(/balance|funds/i);
		expect(model.pendingTransactions).toHaveLength(0);
	});

	it('tampers with a block and reports broken integrity per block', async () => {
		const model = new ChainModel(1);
		model.createWallet('Alice');
		model.createWallet('Bob');
		await model.mine('Alice');
		model.submitTransaction('Alice', 'Bob', 25);
		await model.mine('Bob');
		await model.mine('Bob'); // one more block on top of the payment

		const tampered: number[] = [];
		const validations: Array<{ valid: boolean }> = [];
		model.events.on('chain:tampered', (p) => tampered.push(p.blockIndex));
		model.events.on('chain:validated', (p) => validations.push({ valid: p.valid }));

		expect(model.validateChain().valid).toBe(true);

		model.tamperBlock(2); // the block holding Alice's payment
		expect(tampered).toEqual([2]);

		const report = model.validateChain();
		expect(report.valid).toBe(false);
		// The tampered block's own hash no longer matches its contents…
		expect(report.blocks[2]!.hashValid).toBe(false);
		// …while the genesis and block 1, before the edit, are untouched.
		expect(report.blocks[0]!.hashValid).toBe(true);
		expect(report.blocks[1]!.hashValid).toBe(true);
		// The damage cascades DOWNSTREAM: block 3's previousHash points at
		// what block 2's hash USED to be, so the 2→3 link is broken…
		expect(report.blocks[3]!.linkValid).toBe(false);
		// …while the link INTO the tampered block (1→2) is still intact:
		// block 2's pointer at block 1 was never touched.
		expect(report.blocks[2]!.linkValid).toBe(true);
		expect(validations.map((v) => v.valid)).toEqual([true, false]);
	});
});
