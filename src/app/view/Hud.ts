import { identiconDataUrl } from './identicon';

/**
 * The HUD: plain HTML/CSS over the canvas, Geist-styled.
 *
 *  - top-left: wordmark with a live status dot (teal = chain valid)
 *  - top-right stack: speed control + wallets (identicon, balance,
 *    truncated pubkey in Geist Mono with click-to-copy)
 *  - bottom: a slim event ticker; the newest entry slides in from the
 *    right with a plain-English explanation of what just happened
 *
 * Write-only, like the rest of the View: methods set what to show.
 */
export class Hud {
	/** Right-side panel stack other components (SpeedControl) mount into. */
	readonly rightStack: HTMLDivElement;

	private readonly statusDot: HTMLElement;
	private readonly wallets: HTMLElement;
	private readonly ticker: HTMLElement;
	private readonly identicons = new Map<string, string>();

	constructor(root: HTMLElement) {
		// wordmark
		const wordmark = document.createElement('div');
		wordmark.className = 'wordmark';
		wordmark.innerHTML = `<span class="status-dot" data-status></span>tschain-visualizer`;
		root.appendChild(wordmark);
		this.statusDot = wordmark.querySelector('[data-status]')!;

		// right stack: speed control mounts above, wallets below
		this.rightStack = document.createElement('div');
		this.rightStack.className = 'right-stack';
		root.appendChild(this.rightStack);

		const walletsPanel = document.createElement('div');
		walletsPanel.className = 'panel';
		walletsPanel.innerHTML = `<h2>Wallets</h2><div data-hud="wallets" class="wallets"><em class="muted">spinning up…</em></div>`;
		this.rightStack.appendChild(walletsPanel);
		this.wallets = walletsPanel.querySelector('[data-hud="wallets"]')!;

		// click-to-copy on any pubkey chip
		this.wallets.addEventListener('click', (e) => {
			const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-copy]');
			if (!chip) return;
			void navigator.clipboard.writeText(chip.dataset.copy!).then(() => {
				const original = chip.textContent;
				chip.textContent = 'copied';
				setTimeout(() => (chip.textContent = original), 900);
			});
		});

		// bottom ticker
		this.ticker = document.createElement('div');
		this.ticker.className = 'ticker';
		root.appendChild(this.ticker);
	}

	setWallets(balances: ReadonlyArray<{ name: string; address: string; balance: number }>): void {
		if (balances.length === 0) return;
		this.wallets.innerHTML = balances
			.map((w) => {
				let icon = this.identicons.get(w.address);
				if (!icon) {
					icon = identiconDataUrl(w.address);
					this.identicons.set(w.address, icon);
				}
				const truncated = `0x${w.address.slice(0, 4)}…${w.address.slice(-4)}`;
				return (
					`<div class="wallet-row">` +
					`<img class="identicon" src="${icon}" alt="" />` +
					`<span class="wallet-name">${w.name}</span>` +
					`<button class="mono key-chip" data-copy="${w.address}" title="copy public key">${truncated}</button>` +
					`<span class="wallet-balance mono">${w.balance.toLocaleString('en-US')}</span>` +
					`</div>`
				);
			})
			.join('');
	}

	/** teal dot = chain valid, red = invalid, gray = not yet validated. */
	setChainStatus(valid: boolean | null): void {
		this.statusDot.dataset.state = valid === null ? 'unknown' : valid ? 'valid' : 'invalid';
	}

	/** One plain-English ticker entry, sliding in from the right. */
	logEvent(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
		const entry = document.createElement('span');
		entry.className = `ticker-entry ticker-${kind}`;
		entry.textContent = message;
		this.ticker.prepend(entry);
		while (this.ticker.children.length > 5) this.ticker.lastChild?.remove();
	}
}
