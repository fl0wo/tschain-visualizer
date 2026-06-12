import type { PosChainModel } from '../model/PosChainModel';
import type { Hud } from '../view/Hud';
import type { SceneView } from '../view/SceneView';
import type { ValidatorsPanel } from '../view/ValidatorsPanel';

/**
 * # PosController — the C of the proof-of-stake page
 *
 * Same shape as the PoW Controller, different vocabulary: slots instead
 * of races, attestations instead of nonce attempts, stake instead of
 * hashrate. Wiring and words only — the scene components are the very
 * same ones the PoW and live pages render.
 */
export class PosController {
	constructor(
		private readonly model: PosChainModel,
		private readonly view: SceneView,
		private readonly hud: Hud,
		private readonly validators: ValidatorsPanel,
	) {
		this.subscribeToModel();
		for (const block of model.blocks) this.view.addBlock(block);
		this.validators.setValidators(model.validators);

		this.hud.narrator.say(
			'Proof of Stake — no miners, no race',
			'Validators lock coins as stake. Each slot the protocol pseudo-randomly picks ONE of them to propose the next block — weighted by stake — and the others vote. ' +
				'No trillion guesses, no electricity bill: the security deposit is the skin in the game.',
		);
	}

	private subscribeToModel(): void {
		const { events } = this.model;

		events.on('wallet:created', ({ name, address }) => {
			this.hud.setWallets(this.model.balances);
			this.hud.logEvent(
				`${name} joined (0x${address.slice(0, 4)}…) — the protocol will grant them starter funds in the next block.`,
			);
		});

		events.on('tx:added', (tx) => {
			void this.view.showIncomingTx(tx);
			this.hud.narrator.say(
				'Payment signed & broadcast',
				`${tx.fromName} signed "${tx.amount} to ${tx.toName}" plus a ${tx.fee} fee — which goes to whichever validator PROPOSES the block that includes it. ` +
					`Signature and balance checks are identical to proof of work: consensus changes, cryptography doesn't.`,
				'success',
			);
			this.hud.logEvent(
				`${tx.fromName} → ${tx.toName}: ${tx.amount} (+${tx.fee} fee) verified and queued.`,
				'success',
			);
		});

		events.on('tx:rejected', ({ reason, fromName, toName, amount }) => {
			void this.view.showRejectedTx();
			this.hud.narrator.say(
				'Payment rejected',
				`${reason} Double-spend protection is consensus-independent — stake or work, the mempool's balance check is the same wall.`,
				'error',
			);
			this.hud.logEvent(`${fromName} → ${toName} (${amount}) refused. ${reason}`, 'error');
		});

		events.on('pos:slot', ({ slot, epoch, index, proposerName, seed }) => {
			this.view.startMining(index); // the ghost cube = the proposal
			this.view.updateReadoutLines([`slot ${slot} · epoch ${epoch}`, `${proposerName} proposes`]);
			this.validators.startSlot(proposerName);
			this.hud.narrator.say(
				`Slot ${slot} — ${proposerName} selected to propose`,
				`Seed ${seed} (derived from the slot and the parent hash) picked ${proposerName}, weighted by stake. ` +
					`Selection replaces competition: one proposer per slot, chosen verifiably at random — anyone can recompute this pick from the seed.`,
			);
			this.hud.logEvent(`Slot ${slot}: ${proposerName} proposes block #${index} (seed ${seed}).`);
		});

		events.on('pos:attestation', ({ validatorName, collectedStake, neededStake, totalStake }) => {
			this.view.updateReadoutLines([
				`attesting ${collectedStake}/${totalStake} stake`,
				`needs ${neededStake} (⅔)`,
			]);
			this.validators.markAttested(validatorName);
		});

		events.on('block:mined', (block) => {
			const proposerReward = block.transactions.find((tx) => tx.coinbase && tx.amount >= 2);
			const proposer = proposerReward?.toName ?? 'the proposer';
			void this.view.finishMining(block, 0, [`block #${block.index} sealed ✓`, `≥⅔ stake attested`]);
			this.view.celebrateReward(this.view.blockCount, `+${proposerReward?.amount ?? 2} → ${proposer}`);
			this.validators.endSlot(proposer);
			this.validators.setValidators(this.model.validators);
			this.hud.setWallets(this.model.balances);
			this.hud.narrator.say(
				`Block #${block.index} sealed by ${proposer}`,
				`More than ⅔ of total stake attested, so the block is final the moment it lands — no waiting six confirmations. ` +
					`Rewards are small (+${proposerReward?.amount ?? 2} proposer incl. fees, +1 per attester) because no work was wasted. ` +
					`What keeps everyone honest is the deposit: misbehaving validators get their stake slashed.`,
				'success',
			);
			this.hud.logEvent(
				`Block #${block.index} sealed — proposer ${proposer}, ${block.transactions.length} tx.`,
				'success',
			);
		});

		events.on('stake:changed', ({ validators }) => {
			this.validators.setValidators(validators);
		});

		events.on('chain:validated', (report) => {
			this.view.applyValidation(report);
			this.hud.setChainStatus(report.valid);
			if (!report.valid) {
				this.hud.logEvent('Validation failed — the chain is no longer trustworthy.', 'error');
			}
		});
	}
}
