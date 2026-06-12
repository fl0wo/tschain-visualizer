import type { ChannelSnapshot } from '../../core/layers/Layer2System';

/**
 * Channel list for the Lightning page: each row shows the two parties,
 * the state number (how many OFF-chain updates this channel has seen —
 * the chain saw none of them) and the balance split as a two-color bar
 * matching the 3D edges.
 */
export class ChannelsPanel {
	private readonly list: HTMLElement;

	constructor(root: HTMLElement) {
		const panel = document.createElement('div');
		panel.className = 'panel';
		panel.innerHTML = `
			<h2>Channels <span class="miners-note">state # = off-chain updates</span></h2>
			<div data-channels><em class="muted">waiting for funding…</em></div>`;
		root.appendChild(panel);
		this.list = panel.querySelector('[data-channels]')!;
	}

	update(channels: readonly ChannelSnapshot[]): void {
		const live = channels.filter((c) => c.status !== 'closed');
		if (live.length === 0) return;
		this.list.innerHTML = live
			.map((c) => {
				const total = c.balanceA + c.balanceB;
				const pct = total > 0 ? (c.balanceA / total) * 100 : 50;
				const status = c.status === 'open' ? '' : ` <span class="channel-status">${c.status}</span>`;
				return (
					`<div class="channel-row">` +
					`<div class="channel-title"><span>${c.a} ⇄ ${c.b}</span><span class="mono muted">#${c.stateNumber}${status}</span></div>` +
					`<div class="channel-bar"><span class="channel-bar-a" style="width:${pct.toFixed(1)}%"></span></div>` +
					`<div class="channel-amounts mono muted"><span>${c.balanceA}</span><span>${c.balanceB}</span></div>` +
					`</div>`
				);
			})
			.join('');
	}
}
