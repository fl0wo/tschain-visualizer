/**
 * # BaseSimulation — the heartbeat + debugger transport, page-agnostic
 *
 * Owns everything about WHEN simulated actions happen (jittered timers,
 * time scale, pause / single-step / resume) while subclasses own WHAT
 * happens: `seed()` populates the initial world and `tick()` performs
 * one beat, returning whether anything visible occurred (silent beats
 * are retried by stepOnce so every ⏭ click shows something).
 */
export abstract class BaseSimulation {
	private stopped = false;
	private paused = false;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private _timeScale = 1;

	/** populate the initial world (wallets, stake, …) — called once */
	protected abstract seed(): void;
	/** one beat of life; true if something visible happened */
	protected abstract tick(): boolean;

	start(): void {
		this.seed();
		this.scheduleTick(800);
	}

	stop(): void {
		this.stopped = true;
		this.clearTimer();
	}

	/** Stop GENERATING actions; everything in motion settles naturally. */
	pause(): void {
		this.paused = true;
		this.clearTimer();
	}

	/** Advance exactly one visible beat (implies pause, like a debugger). */
	stepOnce(): void {
		this.pause();
		for (let attempts = 0; attempts < 8; attempts++) {
			if (this.tick()) return;
		}
	}

	resume(): void {
		if (!this.paused || this.stopped) return;
		this.paused = false;
		this.scheduleTick(200 / this._timeScale);
	}

	get timeScale(): number {
		return this._timeScale;
	}

	set timeScale(value: number) {
		this._timeScale = Math.min(16, Math.max(0.05, value));
		// re-arm the pending tick at the new pace; while paused there is
		// nothing to re-arm — the new pace applies on resume
		if (this.timer !== null && !this.stopped && !this.paused) {
			this.clearTimer();
			this.scheduleTick(this.nextDelay());
		}
	}

	/** Jittered cadence (~1.4–3.2s at ×1): organic, never metronomic. */
	protected nextDelay(): number {
		return 1400 + Math.random() * 1800;
	}

	private scheduleTick(delay: number): void {
		if (this.stopped || this.paused) return;
		this.timer = setTimeout(() => {
			this.tick();
			this.scheduleTick(this.nextDelay());
		}, delay / this._timeScale);
	}

	private clearTimer(): void {
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
	}
}
