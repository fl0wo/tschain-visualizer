/**
 * Playback controls, debugger-style: ⏸ stop · ⏭ next step · ▶ continue,
 * plus a speed button that cycles 0.25x → 0.5x → 0.75x → 1x → 1.5x →
 * 2x → 4x and wraps around.
 *
 * Like every view component it only renders and reports: the
 * composition root wires the callbacks to the Simulation (pause /
 * stepOnce / resume / timeScale). The active transport button is
 * highlighted so the current mode is always readable. No step back —
 * a blockchain only moves forward, and so does the demo.
 */

const SPEED_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4] as const;

export class PlaybackControls {
	/** wired by the composition root to Simulation.timeScale */
	onSpeedChange: ((scale: number) => void) | null = null;
	onStop: (() => void) | null = null;
	onStep: (() => void) | null = null;
	onContinue: (() => void) | null = null;

	private speedIndex = SPEED_STEPS.indexOf(1);
	private readonly stopButton: HTMLButtonElement;
	private readonly continueButton: HTMLButtonElement;

	constructor(root: HTMLElement) {
		const panel = document.createElement('div');
		panel.className = 'panel playback';
		panel.innerHTML = `
			<h2>Playback</h2>
			<div class="playback-row">
				<button class="playback-btn" data-pb="stop" aria-label="stop" title="Stop — nothing new happens until you step or continue">⏸</button>
				<button class="playback-btn" data-pb="step" aria-label="next step" title="Next step — advance exactly one action">⏭</button>
				<button class="playback-btn active" data-pb="continue" aria-label="continue" title="Continue — auto-play at the chosen speed">▶</button>
				<span class="playback-divider"></span>
				<button class="playback-btn playback-speed mono" data-pb="speed" aria-label="simulation speed" title="Simulation speed — click to cycle">1x</button>
			</div>`;
		// top of the right stack, above the wallets panel
		root.prepend(panel);

		const get = (name: string) => panel.querySelector<HTMLButtonElement>(`[data-pb="${name}"]`)!;
		this.stopButton = get('stop');
		this.continueButton = get('continue');
		const stepButton = get('step');
		const speedButton = get('speed');

		this.stopButton.addEventListener('click', () => {
			this.setMode('paused');
			this.onStop?.();
		});
		stepButton.addEventListener('click', () => {
			this.setMode('paused'); // stepping implies pausing, like a debugger
			this.onStep?.();
		});
		this.continueButton.addEventListener('click', () => {
			this.setMode('running');
			this.onContinue?.();
		});
		speedButton.addEventListener('click', () => {
			this.speedIndex = (this.speedIndex + 1) % SPEED_STEPS.length;
			const scale = SPEED_STEPS[this.speedIndex]!;
			speedButton.textContent = `${scale}x`;
			this.onSpeedChange?.(scale);
		});
	}

	private setMode(mode: 'running' | 'paused'): void {
		this.continueButton.classList.toggle('active', mode === 'running');
		this.stopButton.classList.toggle('active', mode === 'paused');
	}
}
