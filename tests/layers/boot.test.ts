import { describe, expect, it } from 'vitest';
import { Wallet } from '../../src/core/Wallet';
import { StateChannelNetwork } from '../../src/core/layers/lightning/StateChannelNetwork';
import { OptimisticRollup } from '../../src/core/layers/rollup/OptimisticRollup';
import { posParent, powParent } from '../../src/app/l2/parentAdapters';
import { ChainModel } from '../../src/app/model/ChainModel';
import { PosChainModel } from '../../src/app/model/PosChainModel';

/**
 * Headless boot smoke per Layer-2 page: parent + L2 run a burst of
 * activity together and every cross-layer invariant holds. This is the
 * stand-in for the future registry's boot-all-networks test: a page
 * must be bootable with no DOM, no three.js, no timers left behind.
 */
describe('Layer-2 headless boot', () => {
	it('lightning: parent + channels run a session and stay consistent', async () => {
		const parent = new ChainModel(1);
		const nodes = ['A', 'B', 'C'].map((name) => ({ name, wallet: new Wallet() }));
		for (const n of nodes) parent.adoptWallet(n.name, n.wallet);
		for (const n of nodes) await parent.mine(n.name);

		const network = new StateChannelNetwork(powParent(parent), {
			nodes,
			hopFee: 1,
			disputeWindowBlocks: 2,
			watchtower: true,
			hopMs: 0,
		});
		network.start();

		network.openChannel('A', 'B', 30, 20);
		network.openChannel('B', 'C', 30, 20);
		await parent.mine('A');
		for (let i = 0; i < 6; i++) await network.pay('A', 'C', 2);
		const funds = network.totalChannelFunds();
		expect(funds).toBe(100); // conservation across the whole session

		const last = network.channelList().find((c) => c.a === 'A')!;
		network.closeChannel(last.channelId);
		await parent.mine('B');
		await parent.mine('B');

		expect(parent.validateChain().valid).toBe(true); // the L1 ledger holds
		network.stop(); // no listeners left behind
	});

	it('base: parent + rollup run a session through the full finality ladder', async () => {
		const parent = new PosChainModel({ proposeMs: 0, attestMs: 0 });
		const sequencer = new Wallet();
		const user = new Wallet();
		parent.adoptWallet('Seq', sequencer);
		parent.adoptWallet('User', user);
		await parent.produceSlot();

		const rollup = new OptimisticRollup(posParent(parent), {
			sequencer,
			verifierOn: true,
			challengeWindowBlocks: 2,
			sequencerBond: 60,
			depositConfirmations: 1,
		});
		rollup.start();

		rollup.deposit(user, 40);
		await parent.produceSlot();
		rollup.submitL2Tx(user, sequencer.address, 5);
		rollup.postBatch();
		const tx = rollup.lastTxHash()!;
		expect(rollup.finalityOf(tx)).toBe('soft');
		await parent.produceSlot();
		expect(rollup.finalityOf(tx)).toBe('posted');
		await parent.produceSlot();
		await parent.produceSlot();
		expect(rollup.finalityOf(tx)).toBe('finalized'); // the whole ladder

		expect(parent.validateChain().valid).toBe(true);
		rollup.stop();
	});
});
