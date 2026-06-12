/**
 * Composition root for /live/bitcoin — the same SceneView/Hud the
 * simulation uses, fed by the mempool.space DataSource instead of the
 * engine. Simulation-only HUD (wallets, miners race, playback) stays
 * hidden; the live stats panel and status pill appear instead.
 */
import { MempoolSpaceSource } from '../../core/datasources/mempool/MempoolSpaceSource';
import { Hud } from '../view/Hud';
import { LiveStatsPanel } from '../view/LiveStatsPanel';
import { SceneView } from '../view/SceneView';
import { LiveBitcoinPresenter } from './LiveBitcoinPresenter';

export function mountLiveBitcoinApp(app: HTMLElement): void {
	const view = new SceneView(app);
	const hud = new Hud(app, { hideWallets: true, hideMiners: true });
	hud.onMagicToggle = (enabled) => view.setPostProcessing(enabled);

	const stats = new LiveStatsPanel(hud.rightStack);
	const source = new MempoolSpaceSource();
	new LiveBitcoinPresenter(source, view, hud, stats);

	hud.setSourcePill('connecting');
	void source.start();
}
