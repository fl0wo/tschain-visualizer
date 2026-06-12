/**
 * Composition root for /simulate/pos — the same scene skeleton as the
 * PoW page, with consensus (and its vocabulary) swapped: validators
 * stake instead of miners racing, slots fire on a clock, attestations
 * seal blocks. The miners panel yields its slot to the ValidatorsPanel.
 */
import { PosController } from './controller/PosController';
import { PosSimulation } from './controller/PosSimulation';
import { SimulatedSource } from './datasources/SimulatedSource';
import { PosChainModel } from './model/PosChainModel';
import { Hud } from './view/Hud';
import { PlaybackControls } from './view/PlaybackControls';
import { SceneView } from './view/SceneView';
import { ValidatorsPanel } from './view/ValidatorsPanel';

export function mountPosApp(app: HTMLElement): void {
	const model = new PosChainModel(); // default pacing animates the slot phases
	const view = new SceneView(app);
	const hud = new Hud(app, { hideWallets: false, hideMiners: true });
	hud.onMagicToggle = (enabled) => view.setPostProcessing(enabled);

	const validators = new ValidatorsPanel(hud.leftStack);
	new PosController(model, view, hud, validators);

	const simulation = new PosSimulation(model);
	const source = new SimulatedSource(model, simulation);

	const playback = new PlaybackControls(hud.rightStack);
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
	void source.start();
}
