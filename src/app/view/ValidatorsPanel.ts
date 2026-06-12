import type { ValidatorInfo } from '../../core/events/chainEvents';
import { identiconDataUrl } from './identicon';

/**
 * # ValidatorsPanel — the staking nodes (PoS's answer to the miners race)
 *
 * No rigs, no CPU graphs: validators don't compute, they COMMIT. Each
 * row shows a node's locked stake (its weight in proposer selection,
 * drawn as a share bar) and what it has earned. During a slot the
 * selected proposer is marked ✦, attestation votes light rows up one
 * by one — the committee assembling its ≥2/3 — and the proposer's row
 * flashes when its block seals.
 */
export class ValidatorsPanel {
	private readonly list: HTMLElement;
	private readonly rows = new Map<string, { root: HTMLElement; status: HTMLElement }>();

	constructor(root: HTMLElement) {
		const panel = document.createElement('div');
		panel.className = 'panel validators-panel';
		panel.innerHTML = `
			<h2>Validators <span class="miners-note">stake = selection weight</span></h2>
			<div data-validators><em class="muted">staking…</em></div>`;
		root.appendChild(panel);
		this.list = panel.querySelector('[data-validators]')!;
	}

	setValidators(validators: readonly ValidatorInfo[]): void {
		const totalStake = validators.reduce((sum, v) => sum + v.stake, 0);
		const statuses = new Map(
			[...this.rows.entries()].map(([name, row]) => [name, row.status.textContent ?? '']),
		);
		this.rows.clear();
		this.list.innerHTML = '';
		for (const v of validators) {
			const row = document.createElement('div');
			row.className = 'pool-row validator-row';
			row.innerHTML =
				`<span class="pool-name"><img class="identicon" src="${identiconDataUrl(v.address)}" alt="" /> ${v.name.replace('Validator ', 'V·')}</span>` +
				`<span class="pool-bar"><span class="pool-bar-fill validator-fill" style="width:${((v.stake / totalStake) * 100).toFixed(1)}%"></span></span>` +
				`<span class="pool-share mono">${v.stake}🔒 +${v.earned}</span>`;
			const status = document.createElement('span');
			status.className = 'validator-status mono';
			status.textContent = statuses.get(v.name) ?? '';
			row.appendChild(status);
			this.list.appendChild(row);
			this.rows.set(v.name, { root: row, status });
		}
	}

	/** A slot opened: mark the chosen proposer, reset the committee. */
	startSlot(proposerName: string): void {
		for (const [name, row] of this.rows) {
			row.root.classList.remove('pool-winner');
			row.root.classList.toggle('validator-proposing', name === proposerName);
			row.status.textContent = name === proposerName ? '✦ proposing' : '';
		}
	}

	/** A committee vote arrived. */
	markAttested(name: string): void {
		const row = this.rows.get(name);
		if (!row) return;
		row.status.textContent = '✓ attested';
	}

	/** The block sealed — the proposer's row takes the win flash. */
	endSlot(proposerName: string): void {
		const row = this.rows.get(proposerName);
		if (!row) return;
		row.root.classList.remove('validator-proposing');
		row.root.classList.add('pool-winner');
		row.status.textContent = '✓ sealed';
	}
}
