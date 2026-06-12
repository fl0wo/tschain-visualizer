import { describe, expect, it } from 'vitest';
import { Wallet } from '../../src/core/Wallet';
import { StateChannelNetwork } from '../../src/core/layers/lightning/StateChannelNetwork';
import { powParent } from '../../src/app/l2/parentAdapters';
import { ChainModel } from '../../src/app/model/ChainModel';

/**
 * Lightning's contract, pinned: channel states are dual-signed and
 * strictly increasing; payments NEVER touch the L1; multi-hop conserves
 * funds and fails atomically; broadcasting an old state is punished
 * when watched and profitable when not; closing settles exactly the
 * latest state.
 */
async function setup(options: { watchtower?: boolean } = {}) {
	const model = new ChainModel(1); // PoW parent, honest pace (fast)
	const nodes = ['Lina', 'Milo', 'Nora'].map((name) => ({ name, wallet: new Wallet() }));
	for (const node of nodes) model.adoptWallet(node.name, node.wallet);
	// fund the nodes the only way a PoW economy mints: mining
	for (const node of nodes) await model.mine(node.name);

	const network = new StateChannelNetwork(powParent(model), {
		nodes,
		hopFee: 1,
		disputeWindowBlocks: 2,
		watchtower: options.watchtower ?? true,
		hopMs: 0,
	});
	network.start();

	const open = async (a: string, b: string) => {
		const id = network.openChannel(a, b, 30, 20);
		await model.mine(a); // confirm the funding txs
		return id;
	};
	return { model, network, nodes, open };
}

describe('StateChannelNetwork', () => {
	it('opens only after the funding transactions confirm on the L1', async () => {
		const { model, network } = await setup();
		const id = network.openChannel('Lina', 'Milo', 30, 20);
		expect(network.channel(id).status).toBe('funding'); // the L1 wait
		await model.mine('Nora');
		expect(network.channel(id).status).toBe('open');
		expect(network.channel(id).state.balanceA).toBe(30);
		expect(network.channel(id).state.balanceB).toBe(20);
	});

	it('produces strictly increasing, dual-signed states per payment', async () => {
		const { network, nodes, open } = await setup();
		const id = await open('Lina', 'Milo');
		await network.pay('Lina', 'Milo', 5);
		await network.pay('Milo', 'Lina', 2);

		const channel = network.channel(id);
		expect(channel.state.stateNumber).toBe(2);
		expect(channel.state.balanceA).toBe(27);
		expect(channel.state.balanceB).toBe(23);
		// BOTH parties really signed the latest state (Ed25519)
		const message = network.stateMessage(id, channel.state);
		const [lina, milo] = nodes;
		expect(Wallet.verifyMessage(message, channel.state.sigA, lina!.wallet.address)).toBe(true);
		expect(Wallet.verifyMessage(message, channel.state.sigB, milo!.wallet.address)).toBe(true);
	});

	it('keeps payments entirely off-chain', async () => {
		const { model, network, open } = await setup();
		await open('Lina', 'Milo');
		const blocksBefore = model.blocks.length;
		const pendingBefore = model.pendingTransactions.length;

		for (let i = 0; i < 5; i++) await network.pay('Lina', 'Milo', 1);

		expect(model.blocks.length).toBe(blocksBefore); // no blocks needed
		expect(model.pendingTransactions.length).toBe(pendingBefore); // no txs broadcast
	});

	it('routes multi-hop with conservation, paying the intermediary its fee', async () => {
		const { network, open } = await setup();
		const ab = await open('Lina', 'Milo');
		const bc = await open('Milo', 'Nora');
		const totalBefore = network.totalChannelFunds();

		await network.pay('Lina', 'Nora', 10); // Lina → Milo → Nora

		expect(network.totalChannelFunds()).toBe(totalBefore); // conservation
		// Lina paid 10 + 1 hop fee; Milo netted the fee; Nora received 10
		expect(network.channel(ab).state.balanceA).toBe(30 - 11);
		expect(network.channel(ab).state.balanceB).toBe(20 + 11);
		expect(network.channel(bc).state.balanceA).toBe(30 - 10);
		expect(network.channel(bc).state.balanceB).toBe(20 + 10);
	});

	it('fails multi-hop atomically when a hop lacks liquidity', async () => {
		const { network, open } = await setup();
		const ab = await open('Lina', 'Milo');
		const bc = await open('Milo', 'Nora'); // Milo side holds 30

		const failures: string[] = [];
		network.events.on('payment:failed', (p) => failures.push(p.reason));
		const stateAb = network.channel(ab).state.stateNumber;
		const stateBc = network.channel(bc).state.stateNumber;

		await network.pay('Lina', 'Nora', 31); // hop B→C can't carry 31

		expect(failures).toHaveLength(1);
		// atomic: NO channel advanced its state
		expect(network.channel(ab).state.stateNumber).toBe(stateAb);
		expect(network.channel(bc).state.stateNumber).toBe(stateBc);
	});

	it('punishes a cheater when the watchtower is on', async () => {
		const { model, network, nodes, open } = await setup({ watchtower: true });
		const id = await open('Lina', 'Milo');
		await network.pay('Lina', 'Milo', 10); // latest: 20/30 — old 30/20 favors Lina

		network.attemptCheat(id, 0); // Lina broadcasts the stale state
		await model.mine('Nora'); // the watchtower answers within the window
		await model.mine('Nora'); // justice settlement confirms

		const outcomes: string[] = [];
		network.events.on('dispute:resolved', (d) => outcomes.push(d.outcome));
		expect(network.channel(id).status).toBe('closed');
		// the victim (Milo) takes the WHOLE channel: cheater forfeits
		const milo = nodes[1]!;
		expect(model.getBalance(milo.wallet.address)).toBeGreaterThanOrEqual(50);
	});

	it('lets the cheat succeed when nobody is watching', async () => {
		const { model, network, nodes, open } = await setup({ watchtower: false });
		const id = await open('Lina', 'Milo');
		await network.pay('Lina', 'Milo', 10);

		let outcome = '';
		network.events.on('dispute:resolved', (d) => (outcome = d.outcome));
		network.attemptCheat(id, 0);
		await model.mine('Nora'); // window 2: tick…
		await model.mine('Nora'); // …expired, stale state pays out
		await model.mine('Nora'); // payout settlement confirms

		expect(outcome).toBe('cheat-succeeded');
		// the stale split (30/20) paid out — the cheater kept the 10
		const lina = nodes[0]!;
		expect(model.getBalance(lina.wallet.address)).toBeGreaterThanOrEqual(30);
	});

	it('cooperative close settles exactly the latest state on the L1', async () => {
		const { model, network, nodes, open } = await setup();
		const id = await open('Lina', 'Milo');
		await network.pay('Lina', 'Milo', 12); // latest: 18 / 32
		const [lina, milo] = nodes;
		const linaBefore = model.getBalance(lina!.wallet.address);
		const miloBefore = model.getBalance(milo!.wallet.address);

		network.closeChannel(id);
		await model.mine('Nora'); // settlement confirms

		expect(network.channel(id).status).toBe('closed');
		expect(model.getBalance(lina!.wallet.address)).toBe(linaBefore + 18);
		expect(model.getBalance(milo!.wallet.address)).toBe(miloBefore + 32);
	});
});
