import type { StatsUpdate } from '../../core/events/chainEvents';

/**
 * Right-stack panel for live network stats: mempool size and the fee
 * tiers (how much you'd pay to confirm fast vs cheap — the live fee
 * market, the thing the projection ghosts are made of). Carries the
 * data attribution, as the data deserves.
 */
export class LiveStatsPanel {
	private readonly body: HTMLElement;

	constructor(root: HTMLElement) {
		const panel = document.createElement('div');
		panel.className = 'panel';
		panel.innerHTML = `
			<h2>Bitcoin mempool</h2>
			<div data-live-stats><em class="muted">waiting for data…</em></div>
			<div class="live-attribution">Live data by <a href="https://mempool.space" target="_blank" rel="noopener">mempool.space</a></div>`;
		root.appendChild(panel);
		this.body = panel.querySelector('[data-live-stats]')!;
	}

	update(stats: StatsUpdate): void {
		const rows: string[] = [];
		if (stats.mempoolTxCount !== undefined) {
			rows.push(
				`<div class="live-stat"><span>unconfirmed txs</span><span class="mono">${stats.mempoolTxCount.toLocaleString('en-US')}</span></div>`,
			);
		}
		if (stats.fees) {
			rows.push(
				`<div class="live-stat"><span>fastest</span><span class="mono">${stats.fees.fastest} sat/vB</span></div>`,
				`<div class="live-stat"><span>~30 min</span><span class="mono">${stats.fees.halfHour} sat/vB</span></div>`,
				`<div class="live-stat"><span>~1 hour</span><span class="mono">${stats.fees.hour} sat/vB</span></div>`,
				`<div class="live-stat"><span>economy</span><span class="mono">${stats.fees.economy} sat/vB</span></div>`,
			);
		}
		if (rows.length > 0) this.body.innerHTML = rows.join('');
	}
}
