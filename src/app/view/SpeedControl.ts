/**
 * A lone slider in the top-right corner that sets the simulation's time
 * scale. Like every view component it knows nothing about who listens:
 * it renders, and reports changes through one callback — the composition
 * root decides that the Simulation is on the other end.
 *
 * The slider position maps exponentially (2^v) rather than linearly:
 * "half speed" and "double speed" should feel like equal steps in
 * opposite directions, and a linear 0.25–8 range would cram all the
 * slow settings into the first few pixels.
 */
export class SpeedControl {
	onChange: ((scale: number) => void) | null = null;

	constructor(root: HTMLElement) {
		const panel = document.createElement('div');
		panel.className = 'panel speed-control';
		panel.innerHTML = `
			<h2>Simulation speed</h2>
			<div class="speed-row">
				<span class="muted">slow</span>
				<input type="range" min="-2" max="3" step="0.5" value="0" aria-label="simulation speed" />
				<span class="muted">fast</span>
			</div>
			<div class="speed-value">×1</div>`;
		// Prepend: the speed control sits above whatever else shares the
		// stack (the wallets panel grows downward as users join).
		root.prepend(panel);

		const slider = panel.querySelector('input')!;
		const label = panel.querySelector<HTMLElement>('.speed-value')!;
		slider.addEventListener('input', () => {
			const scale = 2 ** Number(slider.value);
			// ×0.25 … ×0.71 … ×1 … ×2.8 … ×8 — trim trailing zeros.
			label.textContent = `×${scale.toFixed(2).replace(/\.?0+$/, '')}`;
			this.onChange?.(scale);
		});
	}
}
