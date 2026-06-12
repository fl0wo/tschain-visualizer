import type { PosChainModel } from '../model/PosChainModel';
import { BaseSimulation } from './BaseSimulation';

/**
 * # PosSimulation — ambient life for the proof-of-stake page
 *
 * Same population behavior as the PoW page (joiners, payments, the
 * occasional overdraft), but block production is a CLOCK, not a race:
 * a slot fires every few beats whether or not transactions are waiting
 * — empty blocks are normal in PoS, and that steadiness is half the
 * lesson. Validators are protocol infrastructure, not players in the
 * user economy.
 */
export class PosSimulation extends BaseSimulation {
	private static readonly NAMES = [
		'Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank', 'Grace', 'Heidi',
	];
	private static readonly MAX_WALLETS = PosSimulation.NAMES.length;
	/** a slot every ~N beats — the chain's heartbeat */
	private static readonly SLOT_EVERY = 3;

	private producing = false;
	private beat = 0;

	constructor(private readonly model: PosChainModel) {
		super();
	}

	protected override seed(): void {
		this.model.createWallet(PosSimulation.NAMES[0]!);
		this.model.createWallet(PosSimulation.NAMES[1]!);
	}

	protected override tick(): boolean {
		this.beat++;

		// The slot clock: fires regardless of mempool contents.
		if (this.beat % PosSimulation.SLOT_EVERY === 0 && !this.producing) {
			this.producing = true;
			void this.model
				.produceSlot()
				.then(() => this.model.validateChain())
				.finally(() => (this.producing = false));
			return true;
		}

		// Occasionally someone new joins (funded by the next slot's grant).
		if (this.model.walletNames.length < PosSimulation.MAX_WALLETS && Math.random() < 0.12) {
			this.model.createWallet(PosSimulation.NAMES[this.model.walletNames.length]!);
			return true;
		}

		return this.randomPayment();
	}

	private randomPayment(): boolean {
		const funded = this.model.balances.filter((w) => w.balance > 0);
		const sender = funded[Math.floor(Math.random() * funded.length)];
		if (!sender) return false;
		const others = this.model.walletNames.filter((n) => n !== sender.name);
		const receiver = others[Math.floor(Math.random() * others.length)];
		if (!receiver) return false;

		const reserved = this.model.pendingTransactions
			.filter((tx) => tx.fromName === sender.name)
			.reduce((sum, tx) => sum + tx.amount + tx.fee, 0);
		const available = sender.balance - reserved;

		// the same ~1-in-8 deliberate overdraft: double-spend protection
		// is consensus-independent, and the page should still show it
		const overspend = Math.random() < 0.125;
		const amount = overspend
			? Math.max(available, 1) + Math.ceil(Math.random() * 50)
			: Math.ceil(Math.random() * Math.max(available * 0.4, 1));
		const fee = 1 + Math.floor(Math.random() * 3); // tips the PROPOSER here

		if (!overspend && available < amount + fee) return false;
		this.model.submitTransaction(sender.name, receiver, amount, fee);
		return true;
	}
}
