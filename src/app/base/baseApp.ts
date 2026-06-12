/**
 * Composition root for /simulate/base — an optimistic rollup riding a
 * real, ticking PoS parent. Two lanes, one lesson: the L2 is where
 * activity happens (small fast soft cubes), the L1 below is the
 * settlement anchor and the courtroom (bricks, windows, fraud proofs).
 */
import { Wallet } from '../../core/Wallet';
import { OptimisticRollup } from '../../core/layers/rollup/OptimisticRollup';
import { BaseSimulation } from '../controller/BaseSimulation';
import { PosSimulation } from '../controller/PosSimulation';
import { posParent } from '../l2/parentAdapters';
import { BASE } from '../l2/config';
import { PosChainModel } from '../model/PosChainModel';
import { Hud } from '../view/Hud';
import { PlaybackControls } from '../view/PlaybackControls';
import { RollupLaneView } from '../view/RollupLaneView';
import { SceneView } from '../view/SceneView';

const L2_USERS = ['Uma', 'Vik', 'Wes'];

/** ambient L2 traffic: deposit when solvent, then transact fast */
class RollupSimulation extends BaseSimulation {
	private ticksSinceBatch = 0;
	private txSinceBatch = 0;
	private readonly deposited = new Set<string>();

	constructor(
		private readonly rollup: OptimisticRollup,
		private readonly parent: PosChainModel,
		private readonly users: ReadonlyArray<{ name: string; wallet: Wallet }>,
	) {
		super();
	}

	protected override seed(): void {}

	protected override tick(): boolean {
		this.ticksSinceBatch++;

		// batching clock: size OR interval, whichever first
		if (
			this.txSinceBatch >= BASE.batchSize ||
			(this.ticksSinceBatch >= BASE.batchIntervalTicks && this.txSinceBatch > 0)
		) {
			this.rollup.postBatch();
			this.txSinceBatch = 0;
			this.ticksSinceBatch = 0;
			return true;
		}

		// bridge in: users deposit as soon as their faucet grant lands
		for (const user of this.users) {
			if (this.deposited.has(user.name)) continue;
			if (this.parent.getBalance(user.wallet.address) >= 60) {
				this.deposited.add(user.name);
				this.rollup.deposit(user.wallet, 50);
				return true;
			}
		}

		// the fast lane: a couple of L2 payments per beat
		const ready = this.users.filter((u) => this.rollup.l2Balance(u.wallet.address) > 2);
		if (ready.length >= 2) {
			let acted = false;
			for (let i = 0; i < 2; i++) {
				const from = ready[Math.floor(Math.random() * ready.length)]!;
				const others = this.users.filter((u) => u.name !== from.name);
				const to = others[Math.floor(Math.random() * others.length)]!;
				const amount = 1 + Math.floor(Math.random() * 5);
				if (this.rollup.submitL2Tx(from.wallet, to.wallet.address, amount)) {
					this.txSinceBatch++;
					acted = true;
				}
			}
			// the occasional withdrawal shows the asymmetric bridge
			if (Math.random() < 0.06) {
				const user = ready[Math.floor(Math.random() * ready.length)]!;
				this.rollup.withdraw(user.wallet, 5);
			}
			return acted;
		}
		return false;
	}
}

export function mountBaseApp(app: HTMLElement): void {
	document.documentElement.style.setProperty('--active', '#2151f5'); // Base blue

	// ── the parent: a real PoS chain with ambient life ──
	const parent = new PosChainModel({ proposeMs: 500, attestMs: 260 });
	const parentSim = new PosSimulation(parent);

	const sequencer = new Wallet();
	parent.adoptWallet('Sequencer', sequencer);
	const users = L2_USERS.map((name) => {
		const wallet = new Wallet();
		parent.adoptWallet(name, wallet);
		return { name, wallet };
	});

	const rollup = new OptimisticRollup(posParent(parent), {
		sequencer,
		verifierOn: true,
		challengeWindowBlocks: BASE.challengeWindowBlocks,
		sequencerBond: BASE.sequencerBond,
		depositConfirmations: BASE.depositConfirmations,
	});

	const view = new SceneView(app);
	const hud = new Hud(app, { hideWallets: true, hideMiners: true });
	hud.onMagicToggle = (enabled) => view.setPostProcessing(enabled);
	const lane = new RollupLaneView(view.sharedTweens);
	view.attach(lane.group);

	wireEvents(rollup, parent, view, lane, hud);
	buildControls(hud.rightStack, rollup, users, hud);

	const rollupSim = new RollupSimulation(rollup, parent, users);
	const playback = new PlaybackControls(hud.rightStack);
	playback.onSpeedChange = (scale) => {
		parentSim.timeScale = scale;
		rollupSim.timeScale = scale;
	};
	playback.onStop = () => {
		parentSim.pause();
		rollupSim.pause();
	};
	playback.onStep = () => rollupSim.stepOnce();
	playback.onContinue = () => {
		parentSim.resume();
		rollupSim.resume();
	};

	hud.narrator.say(
		'Base — the batch + courtroom model',
		'Transactions settle instantly in the fast lane above — but only "softly": a sequencer ordered them, nobody guarantees them yet. ' +
			'Every few moments the lane compresses into ONE brick posted to Ethereum below, then waits out a challenge window during which anyone can prove fraud. Speed upstairs, justice downstairs.',
	);

	rollup.start();
	parentSim.start();
	rollupSim.start();
}

function wireEvents(
	rollup: OptimisticRollup,
	parent: PosChainModel,
	view: SceneView,
	lane: RollupLaneView,
	hud: Hud,
): void {
	// ── the receded L1 (quiet wiring: blocks land, no slot narration) ──
	parent.events.on('block:mined', (block) => {
		void view.finishMining(block, 0, [`L1 block #${block.index}`, '≥⅔ stake attested']);
		lane.setAnchor((view.blockCount + 1) * 3.6);
	});
	parent.events.on('tx:added', (tx) => {
		void view.showIncomingTx(tx);
		if (tx.kind === 'batch') hud.logEvent('The batch transaction enters the L1 mempool.', 'success');
	});
	for (const block of parent.blocks) view.addBlock(block);
	lane.setAnchor((view.blockCount + 1) * 3.6);

	// ── the L2 story ──
	rollup.events.on('l2tx:soft-confirmed', ({ tx }) => {
		lane.softTx();
		hud.logEvent(`L2: ${tx.fromName} → ${tx.toName}: ${tx.amount} (soft — sequencer ordered).`);
	});

	rollup.events.on('batch:posted', ({ batchId, txCount }) => {
		lane.postBatch(batchId, txCount, BASE.challengeWindowBlocks);
		hud.narrator.say(
			`Batch #${batchId}: ${txCount} L2 txs → ONE L1 tx`,
			'The whole lane just compressed into a single transaction carrying the data and the claimed state root. ' +
				'Ethereum will accept the claim WITHOUT re-executing it — that is the optimism. The data is on-chain, so anyone can check.',
			'success',
		);
		hud.logEvent(`Batch #${batchId} posted (${txCount} txs compressed).`, 'success');
	});

	rollup.events.on('batch:window-tick', ({ batchId, blocksLeft, windowBlocks }) => {
		lane.windowTick(batchId, blocksLeft, windowBlocks);
	});

	rollup.events.on('batch:challenged', ({ batchId }) => {
		lane.challenge(batchId);
		hud.narrator.say(
			`FRAUD PROVEN in batch #${batchId}`,
			'The verifier re-executed the posted data and the state root did not match — the sequencer minted itself funds off the books. ' +
				'The batch and everything after it revert; the sequencer bond is slashed. One honest verifier is all it takes.',
			'error',
		);
		hud.logEvent(`⚖ Batch #${batchId} challenged: state-root mismatch.`, 'error');
	});

	rollup.events.on('batch:reverted', ({ batchId, revertedTxHashes }) => {
		hud.logEvent(`Batch #${batchId} reverted — ${revertedTxHashes.length} L2 txs rolled back.`, 'error');
	});

	rollup.events.on('batch:finalized', ({ batchId, valid }) => {
		lane.finalize(batchId, valid);
		if (valid) {
			hud.logEvent(`Batch #${batchId} finalized — challenge window passed.`, 'success');
		} else {
			hud.narrator.say(
				`An INVALID batch just became final`,
				'Nobody re-executed the data inside the window, so a fraudulent state is now canonical. This is the optimistic trust assumption laid bare: the system is safe only while at least one honest verifier watches.',
				'error',
			);
			hud.logEvent(`Batch #${batchId} finalized INVALID — no verifier challenged it.`, 'error');
		}
	});

	rollup.events.on('deposit:requested', ({ account, amount }) => {
		hud.logEvent(`Deposit: ${account} locks ${amount} on L1…`);
	});
	rollup.events.on('deposit:credited', ({ id }) => {
		lane.depositCrossing();
		hud.logEvent(`Deposit #${id} credited on L2 after one L1 confirmation.`, 'success');
	});

	rollup.events.on('withdrawal:requested', ({ id, account, amount }) => {
		lane.parkWithdrawal(id, `waiting out the window`);
		hud.narrator.say(
			`${account} withdraws ${amount} — now the famous wait`,
			'The burn was instant on L2, but the L1 only releases funds once the batch carrying it FINALIZES — the full challenge window. ' +
				'Deposits are fast, exits are slow: the asymmetry is the price of optimism.',
		);
		hud.logEvent(`Withdrawal #${id}: ${amount} burned on L2, parked at the boundary.`);
	});
	rollup.events.on('withdrawal:ready', ({ id }) => {
		lane.parkWithdrawal(id, 'window passed — releasing');
	});
	rollup.events.on('withdrawal:completed', ({ id }) => {
		lane.completeWithdrawal(id);
		hud.logEvent(`Withdrawal #${id} completed on L1.`, 'success');
	});
}

function buildControls(
	root: HTMLElement,
	rollup: OptimisticRollup,
	users: ReadonlyArray<{ name: string; wallet: Wallet }>,
	hud: Hud,
): void {
	const panel = document.createElement('div');
	panel.className = 'panel';
	panel.innerHTML = `
		<h2>Rollup controls</h2>
		<div class="ln-row">
			<button class="playback-btn active" data-rb="verifier" title="toggle the fraud-proof verifier">🔍 verifier on</button>
			<button class="playback-btn" data-rb="fraud" title="make the sequencer post a fraudulent batch">😈 post fraud</button>
		</div>
		<div class="ln-row">
			<button class="playback-btn" data-rb="withdraw" title="start an L2→L1 withdrawal">⬇ withdraw 5</button>
		</div>`;
	root.appendChild(panel);
	const get = (k: string) => panel.querySelector<HTMLButtonElement>(`[data-rb="${k}"]`)!;

	const verifierBtn = get('verifier');
	verifierBtn.addEventListener('click', () => {
		rollup.verifierOn = !rollup.verifierOn;
		verifierBtn.classList.toggle('active', rollup.verifierOn);
		verifierBtn.textContent = rollup.verifierOn ? '🔍 verifier on' : '🔍 verifier OFF';
		hud.logEvent(
			rollup.verifierOn
				? 'Verifier on — fraudulent batches will be challenged.'
				: 'Verifier OFF — fraud will finalize. Try posting one.',
			rollup.verifierOn ? 'success' : 'error',
		);
	});

	get('fraud').addEventListener('click', () => {
		const posted = rollup.postFraudulentBatch();
		if (posted) hud.logEvent(`😈 Sequencer posted fraudulent batch #${posted.batchId}…`, 'error');
	});

	get('withdraw').addEventListener('click', () => {
		const candidate = users.find((u) => rollup.l2Balance(u.wallet.address) >= 5);
		if (!candidate) {
			hud.logEvent('Nobody has 5 on the L2 yet.', 'error');
			return;
		}
		rollup.withdraw(candidate.wallet, 5);
	});
}
