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

const model = new ChainModel(2); // difficulty 2: snappy ambient mining
const view = new SceneView(app);
const hud = new Hud(app);

new Controller(model, view, hud);

const simulation = new Simulation(model);
const speedControl = new SpeedControl(hud.rightStack); // mounts above the wallets panel
speedControl.onChange = (scale) => {
	simulation.timeScale = scale;
};
simulation.start();
