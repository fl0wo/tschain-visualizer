/**
 * Playback controls, debugger-style: ⏸ stop · ⏭ next step · ▶ continue,
 * plus a speed button that cycles 0.25x → 0.5x → 0.75x → 1x → 1.5x →
 * 2x → 4x and wraps around.
 *
 * Only the speed button is wired today. The transport trio is the UI
 * for the upcoming step-by-step mode (pause the event stream, advance
 * one model event at a time, resume auto-play) — it renders and clicks,
 * but performs nothing yet.
 */

const SPEED_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4] as const;

export class PlaybackControls {
	/** wired by the composition root to Simulation.timeScale */
	onSpeedChange: ((scale: number) => void) | null = null;

	private speedIndex = SPEED_STEPS.indexOf(1);

	constructor(root: HTMLElement) {
		const panel = document.createElement('div');
		panel.className = 'panel playback';
		panel.innerHTML = `
			<h2>Playback</h2>
			<div class="playback-row">
				<button class="playback-btn" data-pb="stop" aria-label="stop" title="Stop — step-by-step mode, coming soon">⏸</button>
				<button class="playback-btn" data-pb="step" aria-label="next step" title="Next step — step-by-step mode, coming soon">⏭</button>
				<button class="playback-btn" data-pb="continue" aria-label="continue" title="Continue (auto-animate) — step-by-step mode, coming soon">▶</button>
				<span class="playback-divider"></span>
				<button class="playback-btn playback-speed mono" data-pb="speed" aria-label="simulation speed" title="Simulation speed — click to cycle">1x</button>
			</div>`;
		// top of the right stack, above the wallets panel
		root.prepend(panel);

		const speed = panel.querySelector<HTMLButtonElement>('[data-pb="speed"]')!;
		speed.addEventListener('click', () => {
			this.speedIndex = (this.speedIndex + 1) % SPEED_STEPS.length;
			const scale = SPEED_STEPS[this.speedIndex]!;
			speed.textContent = `${scale}x`;
			this.onSpeedChange?.(scale);
		});

		// ⏸ ⏭ ▶ — intentionally inert until the step-by-step engine lands.
	}
}
