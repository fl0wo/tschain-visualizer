import { MINING_REWARD } from '../../core/Mempool';
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
			this.hud.narrator.say(
				'Payment signed & broadcast',
				`${tx.fromName} signed "${tx.amount} to ${tx.toName}" with their private key and attached a fee of ${tx.fee} for the miner. ` +
					`Every node re-checks the signature and ${tx.fromName}'s balance before the payment may wait in the mempool.`,
				'success',
			);
			this.hud.logEvent(
				`${tx.fromName} → ${tx.toName}: ${tx.amount} (+${tx.fee} fee) verified and queued in the mempool.`,
				'success',
			);
		});

		events.on('tx:rejected', ({ reason, fromName, toName, amount }) => {
			void this.view.showRejectedTx();
			this.hud.narrator.say(
				'Payment rejected',
				`${reason} The signature was fine — but signatures only prove authorization, not solvency. ` +
					`This balance check is the network's double-spend protection.`,
				'error',
			);
			this.hud.logEvent(`${fromName} → ${toName} (${amount}) refused. ${reason}`, 'error');
		});

		events.on('mining:started', ({ index, minerName, txCount, competitors }) => {
			this.view.startMining(index);
			this.hud.miners.startRace(competitors, (name) => this.addressOf(name));
			this.hud.narrator.say(
				`Mining race — ${competitors.length} miners competing`,
				`Block #${index} (${txCount} tx) is up for grabs. Each miner brute-forces nonces, hunting a hash that starts with ${this.model.difficulty} zero(s). ` +
					`There is no shortcut and no skill — only attempts per second. First valid hash wins everything.`,
			);
			this.hud.logEvent(`${competitors.join(', ')} start racing for block #${index}…`);
			void minerName; // the winner stays secret until the race resolves
		});

		events.on('mining:progress', ({ nonce, hashAttempt }) => {
			this.view.updateMiningReadout(nonce, hashAttempt);
		});

		events.on('block:mined', (block) => {
			void this.view.finishMining(block, this.model.difficulty);
			const coinbase = block.transactions.find((tx) => tx.coinbase);
			const winner = coinbase?.toName ?? 'someone';
			const total = coinbase?.amount ?? MINING_REWARD;
			const fees = total - MINING_REWARD;
			this.hud.miners.endRace(winner, MINING_REWARD, fees);
			this.view.celebrateReward(block.index, `+${total} → ${winner}`);
			this.hud.narrator.say(
				`${winner} wins the race`,
				`Nonce ${block.nonce.toLocaleString('en-US')} produced a valid hash, sealing block #${block.index}. ` +
					`${winner} earns ${total} (${MINING_REWARD} freshly minted + ${fees} in fees). The losers' work is discarded — ` +
					`that "wasted" effort is exactly what an attacker would have to outspend to rewrite history.`,
				'success',
			);
			this.hud.setWallets(this.model.balances);
			this.hud.logEvent(
				`Block #${block.index} mined by ${winner} — nonce ${block.nonce.toLocaleString('en-US')}, reward ${total}. Older blocks grow one confirmation deeper.`,
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
				this.hud.narrator.say(
					'Chain integrity broken',
					`Block(s) ${bad} no longer hash to what their children recorded. Every link downstream of the edit is dead — rewriting history is detectable by anyone, instantly.`,
					'error',
				);
				this.hud.logEvent(`Validation failed at block(s) ${bad} — the chain is no longer trustworthy.`, 'error');
			}
		});
	}

	/** wallet address lookup for the miners panel's identicons */
	private addressOf(name: string): string | undefined {
		return this.model.balances.find((w) => w.name === name)?.address;
	}
}
