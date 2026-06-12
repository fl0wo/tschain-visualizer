import type { ChainModel } from '../model/ChainModel';
import { BaseSimulation } from './BaseSimulation';

/**
 * # Simulation — an automated "population" of users (proof of work)
 *
 * Drives the Model the way a button panel would, on randomized timers:
 * people join the network, pay each other, occasionally try to spend
 * money they don't have (and get rejected), and miners race whenever
 * enough payments are waiting. The Model cannot tell a Simulation tick
 * from a button click — that substitutability is MVC working as
 * intended. Timing/playback lives in BaseSimulation.
 */
export class Simulation extends BaseSimulation {
	private static readonly NAMES = [
		'Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank', 'Grace', 'Heidi',
	];
	private static readonly MAX_WALLETS = Simulation.NAMES.length;

	/** Only one proof-of-work search at a time, like one local miner. */
	private mining = false;

	constructor(private readonly model: ChainModel) {
		super();
	}

	protected override seed(): void {
		this.model.createWallet(Simulation.NAMES[0]!);
		this.model.createWallet(Simulation.NAMES[1]!);
	}

	/**
	 * One beat of network life. Priorities mirror reality: an economy
	 * needs coins before it can have payments, payments accumulate in
	 * the mempool, miners batch them into blocks.
	 */
	protected override tick(): boolean {
		const funded = this.model.balances.filter((w) => w.balance > 0);

		// Nobody has coins yet (or mining stopped paying out): mine first.
		if (funded.length === 0) {
			if (this.mining) return false;
			void this.mine();
			return true;
		}

		// A batch is waiting — usually mine it (but keep some randomness
		// so the pool sometimes grows bigger, like real fee markets).
		if (!this.mining && this.model.pendingTransactions.length >= 3 && Math.random() < 0.7) {
			void this.mine();
			return true;
		}

		// Occasionally someone new joins the network.
		if (this.model.walletNames.length < Simulation.MAX_WALLETS && Math.random() < 0.12) {
			this.model.createWallet(Simulation.NAMES[this.model.walletNames.length]!);
			return true;
		}

		// Default beat: somebody pays somebody.
		return this.randomPayment(funded);
	}

	private randomPayment(funded: Array<{ name: string; balance: number }>): boolean {
		const sender = funded[Math.floor(Math.random() * funded.length)]!;
		const others = this.model.walletNames.filter((n) => n !== sender.name);
		const receiver = others[Math.floor(Math.random() * others.length)];
		if (!receiver) return false;

		// What the sender can actually spend right now: balance minus what
		// they already have pending in the pool.
		const reserved = this.model.pendingTransactions
			.filter((tx) => tx.fromName === sender.name)
			.reduce((sum, tx) => sum + tx.amount, 0);
		const available = sender.balance - reserved;

		// ~1 in 8 payments deliberately overspends. The rejection (and the
		// red falling cube) is part of the show: signatures alone don't
		// make money behave — the mempool's checks do.
		const overspend = Math.random() < 0.125;
		const amount = overspend
			? Math.max(available, 1) + Math.ceil(Math.random() * 50)
			: Math.ceil(Math.random() * Math.max(available * 0.4, 1));
		// every payment tips the miner 1–3: the incentive to be included
		const fee = 1 + Math.floor(Math.random() * 3);

		if (!overspend && available < amount + fee) return false; // genuinely broke: skip the beat
		this.model.submitTransaction(sender.name, receiver, amount, fee);
		return true;
	}

	private async mine(): Promise<void> {
		if (this.mining) return;
		this.mining = true;
		try {
			// The race: a shuffled subset of wallets compete; whoever is
			// drawn first "finds the nonce". The view animates them all —
			// the losers' discarded work is half the lesson.
			const shuffled = [...this.model.walletNames].sort(() => Math.random() - 0.5);
			const racers = shuffled.slice(0, Math.max(2, Math.min(4, shuffled.length)));
			const winner = racers[0]!;
			await this.model.mine(winner, racers);
			// Ambient validation keeps the HUD's verdict fresh (and would
			// catch any tampering the moment the next block lands).
			this.model.validateChain();
		} finally {
			this.mining = false;
		}
	}
}
