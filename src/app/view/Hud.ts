import type { TxInfo } from '../model/ChainModel';

/**
 * The HUD is plain HTML/CSS layered over the WebGL canvas — text is what
 * the DOM is best at, so we don't render text in 3D. It's the app's
 * educational layer: balances, the live mining readout, per-transaction
 * confirmations, and an event log that narrates every event in plain
 * English.
 *
 * Like the rest of the View it is write-only: methods set what to show,
 * and it never reaches into the Model.
 */
export class Hud {
	private readonly wallets: HTMLElement;
	private readonly mining: HTMLElement;
	private readonly chainStatus: HTMLElement;
	private readonly selectedTx: HTMLElement;
	private readonly log: HTMLElement;

	constructor(root: HTMLElement) {
		const panel = document.createElement('div');
		panel.className = 'hud';
		panel.innerHTML = `
			<div class="hud-panel">
				<h2>Wallets</h2>
				<div data-hud="wallets" class="hud-wallets"><em>none yet — create one</em></div>
			</div>
			<div class="hud-panel">
				<h2>Chain</h2>
				<div data-hud="chain-status">not validated yet</div>
				<div data-hud="mining" class="hud-mining"></div>
			</div>
			<div class="hud-panel">
				<h2>Selected transaction</h2>
				<div data-hud="selected-tx"><em>click a sphere to inspect</em></div>
			</div>
			<div class="hud-panel hud-log-panel">
				<h2>Event log</h2>
				<div data-hud="log" class="hud-log"></div>
			</div>`;
		root.appendChild(panel);

		this.wallets = panel.querySelector('[data-hud="wallets"]')!;
		this.mining = panel.querySelector('[data-hud="mining"]')!;
		this.chainStatus = panel.querySelector('[data-hud="chain-status"]')!;
		this.selectedTx = panel.querySelector('[data-hud="selected-tx"]')!;
		this.log = panel.querySelector('[data-hud="log"]')!;
	}

	setWallets(balances: ReadonlyArray<{ name: string; address: string; balance: number }>): void {
		if (balances.length === 0) return;
		this.wallets.innerHTML = balances
			.map(
				(w) =>
					`<div class="hud-wallet"><span class="hud-name">${w.name}</span>` +
					`<span class="hud-addr">${w.address.slice(0, 8)}…</span>` +
					`<span class="hud-balance">${w.balance}</span></div>`,
			)
			.join('');
	}

	/** Live mining readout: the spinning nonce + current hash attempt. */
	setMining(status: { nonce: number; hashAttempt: string } | null): void {
		this.mining.innerHTML = status
			? `<span class="hud-spin">⛏</span> nonce <b>${status.nonce}</b><br>` +
				`<span class="hud-hash">${status.hashAttempt.slice(0, 24)}…</span>`
			: '';
	}

	setChainStatus(valid: boolean | null): void {
		if (valid === null) {
			this.chainStatus.textContent = 'not validated yet';
			this.chainStatus.className = '';
		} else {
			this.chainStatus.textContent = valid ? '✔ chain valid' : '✘ CHAIN INVALID';
			this.chainStatus.className = valid ? 'hud-ok' : 'hud-bad';
		}
	}

	setSelectedTx(tx: TxInfo | null, confirmations?: number): void {
		if (!tx) {
			this.selectedTx.innerHTML = '<em>click a sphere to inspect</em>';
			return;
		}
		const sig = tx.coinbase
			? 'coinbase (minted — no signature)'
			: tx.signatureValid
				? '✔ signature valid'
				: '✘ signature INVALID';
		this.selectedTx.innerHTML =
			`<div>${tx.fromName} → ${tx.toName}: <b>${tx.amount}</b></div>` +
			`<div class="hud-hash">${tx.hash.slice(0, 16)}…</div>` +
			`<div>${sig}</div>` +
			`<div>confirmations: <b>${confirmations ?? 0}</b>${
				confirmations === 0 ? ' (pending)' : ''
			}</div>`;
	}

	/** Append one plain-English line; newest on top. */
	logEvent(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
		const line = document.createElement('div');
		line.className = `hud-log-line hud-log-${kind}`;
		line.textContent = message;
		this.log.prepend(line);
		// Keep the log bounded — it's a ticker, not a database.
		while (this.log.children.length > 60) this.log.lastChild?.remove();
	}
}
