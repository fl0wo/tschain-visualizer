/**
 * Composition root for the PoW simulation (/simulate/pow) — the only
 * place that knows all the MVC parts exist. It builds them, hands the
 * Model to the Controller, and gets out of the way; everything after
 * is event-driven.
 */
import { Controller } from './controller/Controller';
import { Simulation } from './controller/Simulation';
import { ChainModel } from './model/ChainModel';
import { Hud } from './view/Hud';
import { PlaybackControls } from './view/PlaybackControls';
import { SceneView } from './view/SceneView';

export function mountPowApp(app: HTMLElement): void {
	// Demo mining: difficulty 1 (~16 hash attempts per block instead of
	// ~256) stretched over wall-clock time by sleeping between attempts,
	// with a floor so lucky nonces still read as work. Real proof-of-work,
	// negligible battery — the laptop-fan-friendly configuration.
	const model = new ChainModel(1, { yieldEvery: 1, yieldMs: 60, minMs: 900 });
	const view = new SceneView(app);
	const hud = new Hud(app);

	new Controller(model, view, hud);

	// "magic shaders" button → bloom/post-processing on or off
	hud.onMagicToggle = (enabled) => view.setPostProcessing(enabled);

	const simulation = new Simulation(model);
	const playback = new PlaybackControls(hud.rightStack); // mounts above the wallets panel
	playback.onSpeedChange = (scale) => {
		simulation.timeScale = scale;
	};
	playback.onStop = () => {
		simulation.pause();
		hud.logEvent('Simulation paused — ⏭ advances one action at a time, ▶ resumes auto-play.');
	};
	playback.onStep = () => simulation.stepOnce();
	playback.onContinue = () => {
		simulation.resume();
		hud.logEvent('Simulation resumed.');
	};
	simulation.start();
}
