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
	private paused = false;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private _timeScale = 1;

	constructor(private readonly model: ChainModel) {}

	/** Seed the world, then let the random tick loop take over. */
	start(): void {
		this.model.createWallet(Simulation.NAMES[0]!);
		this.model.createWallet(Simulation.NAMES[1]!);
		this.scheduleTick(800);
	}

	stop(): void {
		this.stopped = true;
		this.clearTimer();
	}

	// ── playback (debugger transport) ──────────────────────────────────

	/**
	 * Pause: stop GENERATING new actions. Everything already in motion —
	 * a mining round mid-search, cubes mid-flight — runs to completion,
	 * so the scene settles into a consistent state instead of freezing.
	 */
	pause(): void {
		this.paused = true;
		this.clearTimer();
	}

	/**
	 * Advance exactly one beat: a payment, a new wallet, or a mining
	 * round (whose animation plays at full smoothness — stepping skips
	 * idle time, never the choreography). Implies pause. Some ticks
	 * decide to do nothing (a broke sender skips its turn); those are
	 * retried so every click of ⏭ produces something visible.
	 */
	stepOnce(): void {
		this.pause();
		for (let attempts = 0; attempts < 8; attempts++) {
			if (this.tick()) return;
		}
	}

	/** Resume auto-play at the current time scale. */
	resume(): void {
		if (!this.paused || this.stopped) return;
		this.paused = false;
		this.scheduleTick(200 / this._timeScale);
	}

	private clearTimer(): void {
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
	}

	get timeScale(): number {
		return this._timeScale;
	}

	/**
	 * Speed multiplier for the whole simulation: 2 = events twice as
	 * often, 0.5 = half as often. Only the *cadence* scales — animations
	 * and mining keep their natural pace, so speeding up reads as "a
	 * busier network", not a fast-forwarded video.
	 */
	set timeScale(value: number) {
		this._timeScale = Math.min(16, Math.max(0.05, value));
		// Re-arm the pending tick at the new pace. Without this, dialing
		// up from a slow setting would only take effect after the old
		// (long) delay finally expired. While paused there is nothing to
		// re-arm — the new pace applies on resume.
		if (this.timer !== null && !this.stopped && !this.paused) {
			this.clearTimer();
			this.scheduleTick(this.nextDelay());
		}
	}

	// ── the heartbeat ──────────────────────────────────────────────────

	/** Jittered cadence (~1.4–3.2s at ×1): regular enough to stay alive,
	 *  irregular enough to feel organic. */
	private nextDelay(): number {
		return 1400 + Math.random() * 1800;
	}

	private scheduleTick(delay: number): void {
		if (this.stopped || this.paused) return;
		this.timer = setTimeout(() => {
			this.tick();
			this.scheduleTick(this.nextDelay());
		}, delay / this._timeScale);
	}

	/**
	 * One beat of network life; returns whether anything visible
	 * happened (stepOnce retries the silent beats). Priorities mirror
	 * reality: an economy needs coins before it can have payments,
	 * payments accumulate in the mempool, miners batch them into blocks.
	 */
	private tick(): boolean {
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

	// ── behaviours ─────────────────────────────────────────────────────

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
