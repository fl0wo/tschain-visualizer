import type { ChainModel } from '../model/ChainModel';
import type { Hud } from '../view/Hud';
import type { SceneView } from '../view/SceneView';

/**
 * # Controller — the C in MVC
 *
 * With the simulation driving the Model, the Controller's job is purely
 * the Model → View direction: translate every typed Model event into
 * view/HUD updates. No blockchain rules live here (Model's job) and no
 * rendering lives here (View's job).
 *
 * (Actions flow Model-ward from the Simulation instead of from buttons —
 * the Model can't tell the difference, which is the point of MVC.)
 */
export class Controller {
	constructor(
		private readonly model: ChainModel,
		private readonly view: SceneView,
		private readonly hud: Hud,
	) {
		this.subscribeToModel();

		// Show what already exists (the genesis block).
		for (const block of model.blocks) this.view.addBlock(block);

		this.hud.logEvent('Simulation starting: wallets will appear and start paying each other.', 'info');
	}

	private subscribeToModel(): void {
		const { events } = this.model;

		events.on('wallet:created', ({ name, address }) => {
			this.hud.setWallets(this.model.balances);
			this.hud.logEvent(`${name} joined the network (${address.slice(0, 8)}…) — owns nothing until they mine or get paid.`, 'info');
		});

		events.on('tx:added', (tx) => {
			this.view.mempool.add(tx);
			this.hud.logEvent(
				`${tx.fromName} signed a payment of ${tx.amount} to ${tx.toName} — signature checked, funds reserved, waiting in the mempool.`,
				'success',
			);
		});

		events.on('tx:rejected', ({ reason, fromName, toName, amount }) => {
			this.view.mempool.showRejection();
			this.hud.logEvent(`Payment ${fromName} → ${toName} (${amount}) refused. ${reason}`, 'error');
		});

		events.on('mining:started', ({ index, minerName, txCount }) => {
			this.view.startMining();
			this.hud.logEvent(
				`${minerName} starts mining block #${index} with ${txCount} transaction(s) — searching for a hash with ${this.model.difficulty} leading zeros…`,
				'info',
			);
		});

		events.on('mining:progress', ({ nonce, hashAttempt }) => {
			this.hud.setMining({ nonce, hashAttempt });
		});

		events.on('block:mined', (block) => {
			this.view.finishMining(block);
			this.hud.setMining(null);
			this.hud.setWallets(this.model.balances);
			this.hud.logEvent(
				`Block #${block.index} mined after ${block.nonce} attempts — the coinbase pays the miner, older blocks grow one confirmation deeper.`,
				'success',
			);
		});

		events.on('chain:tampered', ({ blockIndex }) => {
			this.hud.logEvent(`Block #${blockIndex} was silently edited in memory.`, 'error');
		});

		events.on('chain:validated', (report) => {
			this.view.applyValidation(report);
			this.hud.setChainStatus(report.valid);
			// The chain status line already says "valid" — only failures are
			// worth a log entry, and the ambient validation after each block
			// would otherwise drown the interesting events.
			if (!report.valid) {
				const bad = report.blocks
					.filter((b) => !b.hashValid || !b.linkValid || !b.signaturesValid)
					.map((b) => `#${b.index}`)
					.join(', ');
				this.hud.logEvent(`Validation FAILED at block(s) ${bad}.`, 'error');
			}
		});
	}
}
