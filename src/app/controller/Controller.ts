import type { ChainModel, TxInfo } from '../model/ChainModel';
import type { Hud } from '../view/Hud';
import type { SceneView } from '../view/SceneView';

/**
 * # Controller — the C in MVC
 *
 * With the simulation driving the Model, the Controller's job is purely
 * the Model → View direction: translate every typed Model event into
 * scene choreography and HUD updates. No blockchain rules live here
 * (Model's job) and no rendering lives here (View's job).
 */
export class Controller {
	private pinnedTx: TxInfo | null = null;

	constructor(
		private readonly model: ChainModel,
		private readonly view: SceneView,
		private readonly hud: Hud,
	) {
		this.subscribeToModel();

		// Show what already exists (the genesis block).
		for (const block of model.blocks) this.view.addBlock(block);

		// Pinned tooltip ↔ live confirmation counter.
		this.view.onTxPinned = (tx) => {
			this.pinnedTx = tx;
			this.view.setPinnedConfirmations(this.model.getConfirmations(tx.hash));
		};

		this.hud.logEvent('Simulation starting — wallets will appear and start paying each other.');
	}

	private subscribeToModel(): void {
		const { events } = this.model;

		events.on('wallet:created', ({ name, address }) => {
			this.hud.setWallets(this.model.balances);
			this.hud.logEvent(`${name} joined the network (0x${address.slice(0, 4)}…) — owns nothing until they mine or get paid.`);
		});

		events.on('tx:added', (tx) => {
			void this.view.showIncomingTx(tx);
			this.hud.logEvent(
				`${tx.fromName} signed a payment of ${tx.amount} to ${tx.toName} — verified and waiting in the mempool.`,
				'success',
			);
		});

		events.on('tx:rejected', ({ reason, fromName, toName, amount }) => {
			void this.view.showRejectedTx();
			this.hud.logEvent(`${fromName} → ${toName} (${amount}) refused. ${reason}`, 'error');
		});

		events.on('mining:started', ({ index, minerName, txCount }) => {
			this.view.startMining(index);
			this.hud.logEvent(
				`${minerName} is mining block #${index} (${txCount} tx) — hunting a hash with ${this.model.difficulty} leading zeros…`,
			);
		});

		events.on('mining:progress', ({ nonce, hashAttempt }) => {
			this.view.updateMiningReadout(nonce, hashAttempt);
		});

		events.on('block:mined', (block) => {
			void this.view.finishMining(block, this.model.difficulty);
			this.hud.setWallets(this.model.balances);
			this.hud.logEvent(
				`Block #${block.index} mined — nonce ${block.nonce.toLocaleString('en-US')} found. Older blocks grow one confirmation deeper.`,
				'success',
			);
			if (this.pinnedTx) {
				this.view.setPinnedConfirmations(this.model.getConfirmations(this.pinnedTx.hash));
			}
		});

		events.on('chain:tampered', ({ blockIndex }) => {
			this.hud.logEvent(`Block #${blockIndex} was silently edited in memory.`, 'error');
		});

		events.on('chain:validated', (report) => {
			this.view.applyValidation(report);
			this.hud.setChainStatus(report.valid);
			// Routine green validations would drown the ticker; only
			// failures are news.
			if (!report.valid) {
				const bad = report.blocks
					.filter((b) => !b.hashValid || !b.linkValid || !b.signaturesValid)
					.map((b) => `#${b.index}`)
					.join(', ');
				this.hud.logEvent(`Validation failed at block(s) ${bad} — the chain is no longer trustworthy.`, 'error');
			}
		});
	}
}
