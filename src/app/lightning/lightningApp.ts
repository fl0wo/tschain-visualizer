/**
 * Composition root for /simulate/lightning — a state-channel network
 * anchored to a real, ticking PoW parent. The foreground is the channel
 * graph; the Bitcoin chain is a dimmed strip in the background that
 * only lights up when a settlement lands. Bar tab + courtroom.
 */
import { Wallet } from '../../core/Wallet';
import { StateChannelNetwork } from '../../core/layers/lightning/StateChannelNetwork';
import { Simulation } from '../controller/Simulation';
import { LightningSimulation } from '../controller/LightningSimulation';
import { powParent } from '../l2/parentAdapters';
import { LIGHTNING } from '../l2/config';
import { ChainModel } from '../model/ChainModel';
import { ChannelsPanel } from '../view/ChannelsPanel';
import { GraphScene } from '../view/GraphScene';
import { Hud } from '../view/Hud';
import { PlaybackControls } from '../view/PlaybackControls';

const NODE_NAMES = ['Lina', 'Milo', 'Nora', 'Omar', 'Pia', 'Quin'];

export function mountLightningApp(app: HTMLElement): void {
	// lightning yellow accent for this page's HUD
	document.documentElement.style.setProperty('--active', '#f7c548');

	// ── the parent: a real PoW chain with its own ambient life ──
	const parent = new ChainModel(1, { yieldEvery: 1, yieldMs: 40, minMs: 600 });
	const parentSim = new Simulation(parent);

	// lightning nodes are full L1 citizens (they mine to afford channels)
	const nodes = NODE_NAMES.slice(0, LIGHTNING.nodes).map((name) => {
		const wallet = new Wallet();
		parent.adoptWallet(name, wallet);
		return { name, wallet };
	});

	const network = new StateChannelNetwork(powParent(parent), {
		nodes,
		hopFee: LIGHTNING.hopFee,
		disputeWindowBlocks: LIGHTNING.disputeWindowBlocks,
		watchtower: LIGHTNING.watchtowerDefault,
		hopMs: LIGHTNING.hopMs,
	});

	const scene = new GraphScene(app);
	scene.setNodes(NODE_NAMES.slice(0, LIGHTNING.nodes));
	const hud = new Hud(app, { hideWallets: true, hideMiners: true });
	const channels = new ChannelsPanel(hud.leftStack);
	const controls = buildControls(hud.rightStack, network, hud);

	wireEvents(network, parent, scene, hud, channels);

	const lightningSim = new LightningSimulation(network, parent, LIGHTNING.channelFunding);
	const playback = new PlaybackControls(hud.rightStack);
	playback.onSpeedChange = (scale) => {
		parentSim.timeScale = scale;
		lightningSim.timeScale = scale;
	};
	playback.onStop = () => {
		parentSim.pause();
		lightningSim.pause();
	};
	playback.onStep = () => lightningSim.stepOnce();
	playback.onContinue = () => {
		parentSim.resume();
		lightningSim.resume();
	};

	hud.narrator.say(
		'Lightning — the bar tab model',
		'Two parties lock funds on Bitcoin ONCE, then pay each other privately as often as they like — the chain hears nothing. ' +
			'Watch the background: the L1 strip only lights up when a channel opens or settles. Everything else never touches a block.',
	);

	network.start();
	parentSim.start();
	lightningSim.start();
	void controls;
}

function wireEvents(
	network: StateChannelNetwork,
	parent: ChainModel,
	scene: GraphScene,
	hud: Hud,
	channels: ChannelsPanel,
): void {
	const refresh = () => channels.update(network.channelList());

	network.events.on('channel:funding-pending', ({ channelId, a, b }) => {
		scene.dropSettlement(a);
		hud.narrator.say(
			'Opening a channel costs an L1 wait',
			`${a} and ${b} are locking funds in a funding transaction. The channel is unusable until Bitcoin confirms it — the one slow step that buys unlimited fast payments.`,
		);
		hud.logEvent(`${a} ⇄ ${b}: funding tx broadcast (${channelId}) — waiting for a block.`);
		refresh();
	});

	network.events.on('channel:opened', ({ channelId, a, b }) => {
		scene.upsertChannel(network.channel(channelId));
		hud.logEvent(`Channel ${a} ⇄ ${b} confirmed and open.`, 'success');
		refresh();
	});

	network.events.on('channel:updated', ({ channelId }) => {
		scene.upsertChannel(network.channel(channelId));
		refresh();
	});

	network.events.on('payment:routed', ({ path, amount, feePerHop }) => {
		void scene.animatePayment(path, 420);
		const hops = path.length - 2;
		hud.narrator.say(
			hops > 0 ? `Multi-hop payment: ${path.join(' → ')}` : `Direct payment: ${path.join(' → ')}`,
			hops > 0
				? `${amount} routes through ${hops} intermediar${hops === 1 ? 'y' : 'ies'} using hash-locks: locks travel forward, the secret travels backward, so middlemen can forward value they cannot steal — earning ${feePerHop} per hop. No block involved.`
				: `${amount} moves instantly by both parties signing a new channel state. The chain hears nothing.`,
			'success',
		);
		hud.logEvent(`⚡ ${path.join(' → ')}: ${amount} (off-chain).`, 'success');
	});

	network.events.on('payment:failed', ({ reason }) => {
		hud.logEvent(`Payment failed: ${reason}`, 'error');
	});

	network.events.on('channel:close-pending', ({ channelId }) => {
		scene.dropSettlement();
		hud.logEvent(`${channelId}: settlement broadcast — final balances head to the chain.`);
		refresh();
	});

	network.events.on('channel:closed', ({ channelId, finalA, finalB }) => {
		scene.upsertChannel(network.channel(channelId));
		hud.logEvent(`${channelId} closed on-chain: ${finalA}/${finalB}.`, 'success');
		refresh();
	});

	network.events.on('channel:disputed', ({ channelId, cheater, broadcastStateNumber, latestStateNumber, windowBlocks }) => {
		scene.dropSettlement(cheater);
		scene.showDispute(channelId, windowBlocks);
		hud.narrator.say(
			`${cheater} broadcast an OLD state!`,
			`State #${broadcastStateNumber} was published, but #${latestStateNumber} exists — both signatures prove it. A ${windowBlocks}-block dispute window is open: if anyone presents the newer state in time, the cheater forfeits everything.`,
			'error',
		);
		hud.logEvent(`⚠ ${cheater} attempted to cheat on ${channelId}.`, 'error');
		refresh();
	});

	network.events.on('dispute:tick', ({ channelId, blocksLeft }) => {
		scene.showDispute(channelId, blocksLeft);
	});

	network.events.on('dispute:resolved', ({ channelId, outcome, penaltyTo }) => {
		scene.resolveDispute(channelId, outcome);
		if (outcome === 'justice') {
			hud.narrator.say(
				'Justice transaction lands',
				`The watchtower published the newer signed state inside the window: the cheater's entire balance goes to ${penaltyTo}. Cheating with a stale state is provable — and ruinous.`,
				'success',
			);
			hud.logEvent(`⚖ ${channelId}: justice served — penalty to ${penaltyTo}.`, 'success');
		} else {
			hud.narrator.say(
				'The cheat SUCCEEDED',
				'Nobody was watching the chain, the window expired, and the stale state paid out. This is why Lightning needs watchtowers (or staying online): the courtroom only protects those who show up.',
				'error',
			);
			hud.logEvent(`✗ ${channelId}: cheat succeeded — nobody was watching.`, 'error');
		}
		refresh();
	});

	// the background strip: every parent block, lit when it settles L2 business
	parent.events.on('block:mined', (block) => {
		const settlement = block.transactions.some((tx) => tx.kind && tx.kind !== 'transfer');
		scene.pushStripBlock(`#${block.index}`, settlement);
		if (settlement) hud.logEvent(`Bitcoin block #${block.index} carried a channel settlement.`);
	});
}

function buildControls(root: HTMLElement, network: StateChannelNetwork, hud: Hud): HTMLElement {
	const panel = document.createElement('div');
	panel.className = 'panel';
	const names = network.nodeNames();
	const options = names.map((n) => `<option value="${n}">${n}</option>`).join('');
	panel.innerHTML = `
		<h2>Lightning controls</h2>
		<div class="ln-row">
			<select data-ln="from">${options}</select>
			<span class="muted">→</span>
			<select data-ln="to">${options}</select>
			<input data-ln="amount" type="number" min="1" value="5" />
			<button class="playback-btn" data-ln="send" title="send an off-chain payment">⚡</button>
		</div>
		<div class="ln-row">
			<button class="playback-btn active" data-ln="watchtower" title="toggle the watchtower">🗼 watchtower on</button>
			<button class="playback-btn" data-ln="cheat" title="broadcast an old channel state">😈 cheat</button>
		</div>
		<div class="ln-preview mono muted" data-ln="preview"></div>`;
	root.appendChild(panel);

	const get = <T extends HTMLElement>(k: string) => panel.querySelector<T>(`[data-ln="${k}"]`)!;
	const from = get<HTMLSelectElement>('from');
	const to = get<HTMLSelectElement>('to');
	const amount = get<HTMLInputElement>('amount');
	const preview = get('preview');
	to.selectedIndex = 1;

	const updatePreview = () => {
		const path = network.previewPath(from.value, to.value, Number(amount.value) || 1);
		preview.textContent = path ? `route: ${path.join(' → ')}` : 'no route with enough liquidity';
	};
	for (const el of [from, to, amount]) el.addEventListener('input', updatePreview);

	get('send').addEventListener('click', () => {
		if (from.value === to.value) return;
		void network.pay(from.value, to.value, Number(amount.value) || 1);
	});

	const watchtowerBtn = get<HTMLButtonElement>('watchtower');
	watchtowerBtn.addEventListener('click', () => {
		network.watchtower = !network.watchtower;
		watchtowerBtn.classList.toggle('active', network.watchtower);
		watchtowerBtn.textContent = network.watchtower ? '🗼 watchtower on' : '🗼 watchtower OFF';
		hud.logEvent(
			network.watchtower
				? 'Watchtower on — old-state broadcasts will be punished.'
				: 'Watchtower OFF — cheats will succeed. Try one.',
			network.watchtower ? 'success' : 'error',
		);
	});

	get('cheat').addEventListener('click', () => {
		const candidate = network.channelList().find((c) => c.status === 'open' && c.stateNumber > 0);
		if (!candidate) {
			hud.logEvent('No channel with payment history to cheat on yet.', 'error');
			return;
		}
		network.attemptCheat(candidate.channelId, 0);
	});

	return panel;
}
