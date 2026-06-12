import type { ChainModel } from '../model/ChainModel';

/**
 * # Simulation — an automated "population" of users
 *
 * Drives the Model the way the button panel used to, but on randomized
 * timers: people join the network, pay each other, occasionally try to
 * spend money they don't have (and get rejected), and someone mines
 * whenever enough payments are waiting. The Model cannot tell a
 * Simulation tick from a button click — that substitutability is MVC
 * working as intended.
 *
 * Everything here is deliberately probabilistic. Real blockchain traffic
 * is bursty and uncoordinated; jittered timers and weighted dice get
 * surprisingly close to that texture.
 */
export class Simulation {
	private static readonly NAMES = [
		'Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank', 'Grace', 'Heidi',
	];
	private static readonly MAX_WALLETS = Simulation.NAMES.length;

	/** Only one proof-of-work search at a time, like one local miner. */
	private mining = false;
	private stopped = false;

	constructor(private readonly model: ChainModel) {}

	/** Seed the world, then let the random tick loop take over. */
	start(): void {
		this.model.createWallet(Simulation.NAMES[0]!);
		this.model.createWallet(Simulation.NAMES[1]!);
		this.scheduleTick(800);
	}

	stop(): void {
		this.stopped = true;
	}

	// ── the heartbeat ──────────────────────────────────────────────────

	private scheduleTick(delay: number): void {
		if (this.stopped) return;
		setTimeout(() => {
			this.tick();
			// Jittered cadence (~1.4–3.2s): regular enough to stay alive,
			// irregular enough to feel organic.
			this.scheduleTick(1400 + Math.random() * 1800);
		}, delay);
	}

	/**
	 * One beat of network life. Priorities mirror reality:
	 * an economy needs coins before it can have payments, payments
	 * accumulate in the mempool, and miners batch them into blocks.
	 */
	private tick(): void {
		const funded = this.model.balances.filter((w) => w.balance > 0);

		// Nobody has coins yet (or mining stopped paying out): mine first.
		if (funded.length === 0) {
			void this.mine();
			return;
		}

		// A batch is waiting — usually mine it (but keep some randomness
		// so the pool sometimes grows bigger, like real fee markets).
		if (this.model.pendingTransactions.length >= 3 && Math.random() < 0.7) {
			void this.mine();
			return;
		}

		// Occasionally someone new joins the network.
		if (this.model.walletNames.length < Simulation.MAX_WALLETS && Math.random() < 0.12) {
			this.model.createWallet(Simulation.NAMES[this.model.walletNames.length]!);
			return;
		}

		// Default beat: somebody pays somebody.
		this.randomPayment(funded);
	}

	// ── behaviours ─────────────────────────────────────────────────────

	private randomPayment(funded: Array<{ name: string; balance: number }>): void {
		const sender = funded[Math.floor(Math.random() * funded.length)]!;
		const others = this.model.walletNames.filter((n) => n !== sender.name);
		const receiver = others[Math.floor(Math.random() * others.length)];
		if (!receiver) return;

		// What the sender can actually spend right now: balance minus what
		// they already have pending in the pool.
		const reserved = this.model.pendingTransactions
			.filter((tx) => tx.fromName === sender.name)
			.reduce((sum, tx) => sum + tx.amount, 0);
		const available = sender.balance - reserved;

		// ~1 in 8 payments deliberately overspends. The rejection (and the
		// red falling sphere) is part of the show: signatures alone don't
		// make money behave — the mempool's checks do.
		const overspend = Math.random() < 0.125;
		const amount = overspend
			? Math.max(available, 1) + Math.ceil(Math.random() * 50)
			: Math.ceil(Math.random() * Math.max(available * 0.4, 1));

		if (!overspend && available < 1) return; // genuinely broke: skip the beat
		this.model.submitTransaction(sender.name, receiver, amount);
	}

	private async mine(): Promise<void> {
		if (this.mining) return;
		this.mining = true;
		try {
			const names = this.model.walletNames;
			const miner = names[Math.floor(Math.random() * names.length)]!;
			await this.model.mine(miner);
			// Ambient validation keeps the HUD's verdict fresh (and would
			// catch any tampering the moment the next block lands).
			this.model.validateChain();
		} finally {
			this.mining = false;
		}
	}
}
