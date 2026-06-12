/**
 * Composition root — the only file that knows all three MVC parts exist.
 * It builds them, hands the Model to the Controller, and gets out of the
 * way. Everything after this line is event-driven.
 */
import './app/style.css';
import { Controller } from './app/controller/Controller';
import { Simulation } from './app/controller/Simulation';
import { ChainModel } from './app/model/ChainModel';
import { Hud } from './app/view/Hud';
import { SceneView } from './app/view/SceneView';
import { SpeedControl } from './app/view/SpeedControl';
import { applyCssVars } from './app/view/theme';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app container missing in index.html');

// Mirror the theme palette into CSS custom properties before any UI builds.
applyCssVars();

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
const speedControl = new SpeedControl(hud.rightStack); // mounts above the wallets panel
speedControl.onChange = (scale) => {
	simulation.timeScale = scale;
};
simulation.start();
