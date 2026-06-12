import type { PoolStat } from '../../core/events/chainEvents';

/**
 * # PoolsPanel — the live page's miners panel
 *
 * The honest live-Bitcoin counterpart of the simulation's mining race:
 * nobody can list who is "currently hashing" (miners work privately —
 * only the winner ever becomes known, and even that is a coinbase-tag
 * heuristic), so this shows the best public estimate instead: each
 * pool's share of the last 24h of blocks, which IS its approximate
 * probability of mining the next one. Mining is a weighted lottery;
 * this panel is the ticket count.
 *
 * When a block confirms, the winning pool's row flashes — the lottery
 * draw resolving in front of you.
 */
export class PoolsPanel {
	private readonly list: HTMLElement;
	private readonly footer: HTMLElement;
	private readonly rows = new Map<string, HTMLElement>();

	constructor(root: HTMLElement) {
		const panel = document.createElement('div');
		panel.className = 'panel pools-panel';
		panel.innerHTML = `
			<h2>Mining pools <span class="miners-note">last 24h ≈ next-block odds</span></h2>
			<div data-pools><em class="muted">waiting for data…</em></div>
			<div class="pools-footer muted" data-pools-footer></div>`;
		root.appendChild(panel);
		this.list = panel.querySelector('[data-pools]')!;
		this.footer = panel.querySelector('[data-pools-footer]')!;
	}

	update(pools: readonly PoolStat[], sampleBlocks: number, networkHashrateEhs?: number): void {
		const top = pools.slice(0, 6);
		const restShare = pools.slice(6).reduce((sum, p) => sum + p.share, 0);

		this.rows.clear();
		this.list.innerHTML = '';
		for (const pool of top) {
			const row = document.createElement('div');
			row.className = 'pool-row';
			row.innerHTML =
				`<span class="pool-name">${pool.name}</span>` +
				`<span class="pool-bar"><span class="pool-bar-fill" style="width:${(pool.share * 100).toFixed(1)}%"></span></span>` +
				`<span class="pool-share mono">${(pool.share * 100).toFixed(0)}%</span>`;
			this.list.appendChild(row);
			this.rows.set(pool.name, row);
		}
		if (restShare > 0.001) {
			const row = document.createElement('div');
			row.className = 'pool-row pool-others';
			row.innerHTML =
				`<span class="pool-name">others</span>` +
				`<span class="pool-bar"><span class="pool-bar-fill" style="width:${(restShare * 100).toFixed(1)}%"></span></span>` +
				`<span class="pool-share mono">${(restShare * 100).toFixed(0)}%</span>`;
			this.list.appendChild(row);
		}

		this.footer.textContent =
			`${sampleBlocks} blocks sampled` +
			(networkHashrateEhs !== undefined ? ` · network ~${Math.round(networkHashrateEhs)} EH/s` : '');
	}

	/** The lottery resolved: flash the winner's row. */
	highlight(poolName: string): void {
		const row = this.rows.get(poolName);
		if (!row) return;
		row.classList.remove('pool-winner');
		void row.offsetWidth;
		row.classList.add('pool-winner');
	}
}
