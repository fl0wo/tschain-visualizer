/**
 * # HomePage — the catalog
 *
 * Two categories: Simulations (consensus mechanisms you can watch) and
 * Live (real networks — not wired yet). Rendered as a keyboard-driven
 * grid: ←→ move within a row, ↑↓ between rows, Enter opens. Items are
 * real <button>s with roving focus, so Enter/Space and screen readers
 * work for free; disabled entries stay focusable (you can browse the
 * catalog) but refuse activation with a small shake.
 *
 * The Live section is laid out by settlement: each row starts with a
 * Layer-1 chain, and the rollups that settle ON it sit to its right
 * behind a ↳ connector — plus explicit L1/L2 badges and a legend.
 */

interface MenuItem {
	label: string;
	sub?: string;
	badge?: 'L1' | 'L2';
	route?: string;
	disabled?: boolean;
	/** renders a ↳ connector before this item (first L2 of its row) */
	connector?: boolean;
}

interface MenuRow {
	items: MenuItem[];
}

const SIMULATIONS: MenuRow = {
	items: [
		{ label: 'PoW', sub: 'Proof of Work', route: '/simulate/pow' },
		{ label: 'PoS', sub: 'Proof of Stake', disabled: true },
		{ label: 'PoA', sub: 'Proof of Authority', disabled: true },
		{ label: 'PoH', sub: 'Proof of History', disabled: true },
	],
};

const LIVE: MenuRow[] = [
	{
		items: [
			{ label: 'Bitcoin', sub: 'mainnet, live', badge: 'L1', route: '/live/bitcoin' },
			{ label: 'Lightning', sub: 'payment channels', badge: 'L2', connector: true },
		],
	},
	{
		items: [
			{ label: 'Ethereum', badge: 'L1' },
			{ label: 'Arbitrum', badge: 'L2', connector: true },
			{ label: 'Base', badge: 'L2' },
			{ label: 'Optimism', badge: 'L2' },
			{ label: 'zkSync', badge: 'L2' },
			{ label: 'Linea', badge: 'L2' },
			{ label: 'Scroll', badge: 'L2' },
		],
	},
	{
		items: [{ label: 'Solana', badge: 'L1' }],
	},
];

export class HomePage {
	private readonly rows: MenuItem[][];
	private readonly cells: HTMLButtonElement[][] = [];
	private focusRow = 0;
	private focusCol = 0;
	private readonly keyHandler = (e: KeyboardEvent) => this.onKey(e);
	private readonly root: HTMLElement;

	constructor(container: HTMLElement, private readonly navigateTo: (path: string) => void) {
		this.rows = [SIMULATIONS.items, ...LIVE.map((row) => row.items)];

		this.root = document.createElement('div');
		this.root.className = 'home';
		this.root.innerHTML = `
			<div class="home-wordmark"><span class="status-dot" data-state="valid"></span>tschain-visualizer</div>
			<p class="home-tagline">watch how blockchains work, one block at a time</p>
			<section>
				<h2>Simulations</h2>
				<div class="menu-rows" data-section="simulations"></div>
			</section>
			<section>
				<h2>Live</h2>
				<div class="menu-legend">
					<span class="badge badge-l1">L1</span> base chain — settles itself
					<span class="legend-gap"></span>
					<span class="badge badge-l2">L2</span> rollup — settles on the L1 to its left
				</div>
				<div class="menu-rows" data-section="live"></div>
			</section>
			<p class="home-hint mono">←↑↓→ move · enter open</p>`;
		container.appendChild(this.root);

		this.renderRows(this.root.querySelector('[data-section="simulations"]')!, [SIMULATIONS.items], 0);
		this.renderRows(this.root.querySelector('[data-section="live"]')!, LIVE.map((r) => r.items), 1);

		window.addEventListener('keydown', this.keyHandler);
		this.focusCell(0, 0);
	}

	dispose(): void {
		window.removeEventListener('keydown', this.keyHandler);
		this.root.remove();
	}

	private renderRows(container: Element, rows: MenuItem[][], rowOffset: number): void {
		rows.forEach((items, i) => {
			const rowIndex = rowOffset + i;
			const rowEl = document.createElement('div');
			rowEl.className = 'menu-row';
			const cellRow: HTMLButtonElement[] = [];
			items.forEach((item, col) => {
				if (item.connector) {
					const connector = document.createElement('span');
					connector.className = 'menu-connector mono';
					connector.textContent = '↳';
					rowEl.appendChild(connector);
				}
				const card = document.createElement('button');
				card.className = `menu-card${item.disabled ? ' menu-disabled' : ''}`;
				card.setAttribute('aria-disabled', String(!!item.disabled));
				card.innerHTML =
					`<span class="menu-label">${item.label}</span>` +
					(item.sub ? `<span class="menu-sub">${item.sub}</span>` : '') +
					(item.badge ? `<span class="badge badge-${item.badge.toLowerCase()}">${item.badge}</span>` : '') +
					(item.disabled ? `<span class="menu-soon mono">soon</span>` : '');
				card.addEventListener('click', () => this.activate(item, card));
				card.addEventListener('focus', () => {
					this.focusRow = rowIndex;
					this.focusCol = col;
				});
				card.addEventListener('mouseenter', () => card.focus());
				rowEl.appendChild(card);
				cellRow.push(card);
			});
			container.appendChild(rowEl);
			this.cells[rowIndex] = cellRow;
		});
	}

	private activate(item: MenuItem, card: HTMLElement): void {
		if (item.route) {
			this.navigateTo(item.route);
			return;
		}
		// not wired (disabled sim or live chain): a polite refusal
		card.classList.remove('menu-shake');
		void card.offsetWidth;
		card.classList.add('menu-shake');
	}

	private onKey(e: KeyboardEvent): void {
		const deltas: Record<string, [number, number]> = {
			ArrowLeft: [0, -1],
			ArrowRight: [0, 1],
			ArrowUp: [-1, 0],
			ArrowDown: [1, 0],
		};
		const delta = deltas[e.key];
		if (!delta) return; // Enter/Space are native button activation
		e.preventDefault();
		const row = Math.min(Math.max(this.focusRow + delta[0], 0), this.cells.length - 1);
		const maxCol = this.cells[row]!.length - 1;
		// moving vertically keeps the column where possible
		const col = Math.min(Math.max(this.focusCol + delta[1], 0), maxCol);
		this.focusCell(row, col);
	}

	private focusCell(row: number, col: number): void {
		this.focusRow = row;
		this.focusCol = col;
		this.cells[row]?.[col]?.focus();
	}
}
