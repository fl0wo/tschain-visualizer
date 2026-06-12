/**
 * Entry point + a deliberately tiny router.
 *
 *   /              → the catalog (HomePage)
 *   /simulate/pow  → the proof-of-work visualizer
 *
 * History-API based (Vite's SPA fallback serves index.html for any
 * path). Forward navigation re-mounts views in place; BACK uses a full
 * reload — the WebGL app owns a renderer loop, timers and listeners,
 * and a fresh boot is more reliable than a hand-written teardown.
 */
import './app/style.css';
import { mountLiveBitcoinApp } from './app/live/liveBitcoinApp';
import { mountPowApp } from './app/powApp';
import { applyCssVars } from './app/view/theme';
import { HomePage } from './home/HomePage';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app container missing in index.html');

// Mirror the theme palette into CSS custom properties before any UI builds.
applyCssVars();

let cleanup: (() => void) | null = null;

function render(path: string): void {
	cleanup?.();
	cleanup = null;
	app!.innerHTML = '';

	if (path === '/simulate/pow') {
		document.title = 'tschain — PoW simulation';
		mountPowApp(app!);
		return;
	}

	if (path === '/live/bitcoin') {
		document.title = 'tschain — Bitcoin, live';
		mountLiveBitcoinApp(app!);
		return;
	}

	// anything unknown lands on the catalog
	if (path !== '/') history.replaceState(null, '', '/');
	document.title = 'tschain-visualizer';
	const home = new HomePage(app!, navigate);
	cleanup = () => home.dispose();
}

function navigate(path: string): void {
	history.pushState(null, '', path);
	render(path);
}

window.addEventListener('popstate', () => location.reload());

render(location.pathname);
