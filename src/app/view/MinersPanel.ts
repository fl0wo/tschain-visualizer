import { identiconDataUrl } from './identicon';

/**
 * # MinersPanel — the proof-of-work race, made visible
 *
 * Real PoW is a competition: every miner hashes as fast as it can, ONE
 * wins the block, and everyone else's work is thrown away. The chain
 * animation only shows the winner, so this panel shows the race itself:
 * each competitor with a spinning nonce counter and (simulated) CPU/RAM
 * telemetry that spikes while hashing — then the verdict, with the
 * winner's reward breakdown and the losers' "work discarded".
 *
 * The telemetry is explicitly simulated (this demo deliberately does
 * NOT burn your CPU — see MiningPace), but its shape is truthful:
 * mining pins cores at ~100% for the whole search, win or lose.
 */

interface MinerRow {
	root: HTMLElement;
	status: HTMLElement;
	nonce: HTMLElement;
	cpuFill: HTMLElement;
	cpuLabel: HTMLElement;
	ram: HTMLElement;
	/** fake per-miner hash rate, attempts per tick */
	rate: number;
	count: number;
	ramMb: number;
}

export class MinersPanel {
	private readonly list: HTMLElement;
	private readonly rows = new Map<string, MinerRow>();
	private ticker: ReturnType<typeof setInterval> | null = null;

	constructor(root: HTMLElement, options: { hidden?: boolean } = {}) {
		const panel = document.createElement('div');
		panel.className = 'panel miners-panel';
		if (options.hidden) panel.style.display = 'none';
		panel.innerHTML = `
			<h2>Mining race <span class="miners-note">simulated telemetry</span></h2>
			<div class="miners-list" data-miners><em class="muted">waiting for the first race…</em></div>`;
		root.appendChild(panel);
		this.list = panel.querySelector('[data-miners]')!;
	}

	/** A new block is up for grabs: spin up every competitor. */
	startRace(competitors: readonly string[], addressOf: (name: string) => string | undefined): void {
		this.stopTicker();
		this.rows.clear();
		this.list.innerHTML = '';

		for (const name of competitors) {
			const address = addressOf(name);
			const root = document.createElement('div');
			root.className = 'miner-row';
			root.innerHTML =
				`<img class="identicon" src="${address ? identiconDataUrl(address) : ''}" alt="" />` +
				`<span class="miner-name">${name}</span>` +
				`<span class="miner-status" data-status>hashing…</span>` +
				`<span class="miner-nonce mono" data-nonce>0</span>` +
				`<span class="miner-cpu"><span class="miner-cpu-fill" data-cpu></span></span>` +
				`<span class="miner-meta mono"><span data-cpu-label>0%</span> · <span data-ram>0</span>MB</span>`;
			this.list.appendChild(root);
			this.rows.set(name, {
				root,
				status: root.querySelector('[data-status]')!,
				nonce: root.querySelector('[data-nonce]')!,
				cpuFill: root.querySelector('[data-cpu]')!,
				cpuLabel: root.querySelector('[data-cpu-label]')!,
				ram: root.querySelector('[data-ram]')!,
				// every miner guesses at its own pace — that's the race
				rate: 40 + Math.random() * 120,
				count: Math.floor(Math.random() * 50),
				ramMb: 180 + Math.random() * 120,
			});
		}

		// ~8 updates/s: lively but readable, and trivially cheap.
		this.ticker = setInterval(() => this.tick(), 125);
	}

	/** The verdict: one winner collects, everyone else wrote off the work. */
	endRace(winner: string, baseReward: number, fees: number): void {
		this.stopTicker();
		for (const [name, row] of this.rows) {
			if (name === winner) {
				row.root.classList.add('miner-winner');
				row.status.textContent = `found it! +${baseReward + fees} (${baseReward} reward + ${fees} fees)`;
			} else {
				row.root.classList.add('miner-loser');
				row.status.textContent = 'race lost — work discarded';
			}
			// the rigs spin down either way
			row.cpuFill.style.width = '4%';
			row.cpuLabel.textContent = '4%';
		}
	}

	private tick(): void {
		for (const row of this.rows.values()) {
			row.count += Math.floor(row.rate * (0.7 + Math.random() * 0.6));
			row.nonce.textContent = row.count.toLocaleString('en-US');
			const cpu = 82 + Math.random() * 17; // pinned, with thermal jitter
			row.cpuFill.style.width = `${cpu}%`;
			row.cpuLabel.textContent = `${Math.round(cpu)}%`;
			row.ramMb += (Math.random() - 0.45) * 6; // slow upward creep
			row.ram.textContent = String(Math.round(row.ramMb));
		}
	}

	private stopTicker(): void {
		if (this.ticker !== null) clearInterval(this.ticker);
		this.ticker = null;
	}
}
