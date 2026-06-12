import { describe, expect, it } from 'vitest';
import { Wallet } from '../../src/core/Wallet';
import { OptimisticRollup, reExecuteBatch } from '../../src/core/layers/rollup/OptimisticRollup';
import { posParent } from '../../src/app/l2/parentAdapters';
import { PosChainModel } from '../../src/app/model/PosChainModel';

/**
 * The optimistic rollup's contract, pinned: posted batch data alone
 * re-derives the state root (data availability); a proven fraud reverts
 * exactly the fraudulent batch and everything after; an UNchallenged
 * fraud finalizes (the trust assumption, documented); the bridge is
 * asymmetric (deposits wait one confirmation, withdrawals wait out the
 * whole challenge window); soft state never survives a revert.
 */
async function setup(options: { verifierOn?: boolean } = {}) {
	const parent = new PosChainModel({ proposeMs: 0, attestMs: 0 });
	const sequencer = new Wallet();
	const alice = new Wallet();
	const bob = new Wallet();
	parent.adoptWallet('Sequencer', sequencer);
	parent.adoptWallet('Alice', alice);
	parent.adoptWallet('Bob', bob);
	await parent.produceSlot(); // faucet grants land (100 each)

	const rollup = new OptimisticRollup(posParent(parent), {
		sequencer,
		verifierOn: options.verifierOn ?? true,
		challengeWindowBlocks: 2,
		sequencerBond: 60,
		depositConfirmations: 1,
	});
	rollup.start();
	return { parent, rollup, sequencer, alice, bob };
}

describe('OptimisticRollup', () => {
	it('credits a deposit only after its L1 transaction confirms', async () => {
		const { parent, rollup, alice } = await setup();
		rollup.deposit(alice, 40);
		expect(rollup.l2Balance(alice.address)).toBe(0); // locked, not credited
		await parent.produceSlot(); // the deposit tx confirms
		expect(rollup.l2Balance(alice.address)).toBe(40);
		// and the L1 actually debited Alice
		expect(parent.getBalance(alice.address)).toBe(60);
	});

	it('soft-confirms L2 transactions instantly, without any L1 block', async () => {
		const { parent, rollup, alice, bob } = await setup();
		rollup.deposit(alice, 40);
		await parent.produceSlot();
		const blocksBefore = parent.blocks.length;

		const ok = rollup.submitL2Tx(alice, bob.address, 15);
		expect(ok).toBe(true);
		expect(rollup.l2Balance(alice.address)).toBe(25);
		expect(rollup.l2Balance(bob.address)).toBe(15);
		expect(parent.blocks.length).toBe(blocksBefore); // L1 untouched
		expect(rollup.finalityOf(rollup.lastTxHash()!)).toBe('soft');
	});

	it('posted batch data alone re-derives the postStateRoot (data availability)', async () => {
		const { parent, rollup, alice, bob } = await setup();
		rollup.deposit(alice, 40);
		await parent.produceSlot();
		rollup.submitL2Tx(alice, bob.address, 15);
		rollup.submitL2Tx(alice, bob.address, 5);

		const batch = rollup.postBatch()!;
		await parent.produceSlot(); // the batch tx lands on L1

		// fetch the data FROM THE CHAIN — anyone can do this
		const memo = parent.getTransactionMemo(batch.l1TxHash)!;
		const derived = reExecuteBatch(memo);
		expect(derived).toBe(batch.postStateRoot);
		expect(rollup.finalityOf(rollup.lastTxHash()!)).toBe('posted');
	});

	it('a challenged fraud reverts exactly the fraudulent batch and after', async () => {
		const { parent, rollup, alice, bob } = await setup({ verifierOn: true });
		rollup.deposit(alice, 40);
		await parent.produceSlot();

		// honest batch 1
		rollup.submitL2Tx(alice, bob.address, 10);
		rollup.postBatch();
		await parent.produceSlot();

		// fraudulent batch 2: the sequencer mints itself funds
		const reverted: number[] = [];
		rollup.events.on('batch:reverted', (p) => reverted.push(p.batchId));
		rollup.postFraudulentBatch();
		// a soft tx AFTER the fraud — must not survive the revert
		rollup.submitL2Tx(alice, bob.address, 5);
		await parent.produceSlot(); // batch confirms → verifier re-executes → challenge

		expect(reverted).toHaveLength(1);
		// rollback boundary: honest batch 1 state intact, everything after gone
		expect(rollup.l2Balance(bob.address)).toBe(10);
		expect(rollup.l2Balance(alice.address)).toBe(30);
		expect(rollup.l2Balance(rollup.sequencerAddress)).toBe(0); // minted funds gone
	});

	it('an UNchallenged fraud finalizes — the trust assumption, stated', async () => {
		const { parent, rollup, alice } = await setup({ verifierOn: false });
		rollup.deposit(alice, 40);
		await parent.produceSlot();
		rollup.postFraudulentBatch();

		const finalized: Array<{ batchId: number; valid: boolean }> = [];
		rollup.events.on('batch:finalized', (p) => finalized.push(p));
		await parent.produceSlot(); // confirm
		await parent.produceSlot(); // window 2: tick
		await parent.produceSlot(); // window elapsed

		expect(finalized).toHaveLength(1);
		expect(finalized[0]!.valid).toBe(false); // an invalid state became final
		expect(rollup.l2Balance(rollup.sequencerAddress)).toBeGreaterThan(0);
	});

	it('withdrawals wait out the challenge window; deposits do not', async () => {
		const { parent, rollup, alice } = await setup();
		rollup.deposit(alice, 40);
		await parent.produceSlot();

		const events: string[] = [];
		rollup.events.on('withdrawal:ready', () => events.push('ready'));
		rollup.events.on('withdrawal:completed', () => events.push('completed'));

		rollup.withdraw(alice, 20);
		expect(rollup.l2Balance(alice.address)).toBe(20); // burned immediately
		rollup.postBatch();
		await parent.produceSlot(); // batch confirms — window starts
		expect(events).toHaveLength(0); // NOT ready: the courtroom is open
		await parent.produceSlot(); // window 1/2
		expect(events).toHaveLength(0);
		await parent.produceSlot(); // window 2/2 → finalized → ready → completes
		expect(events).toContain('ready');
		await parent.produceSlot(); // the L1 payout confirms
		expect(events).toContain('completed');
		expect(parent.getBalance(alice.address)).toBe(60 + 20);
	});
});
