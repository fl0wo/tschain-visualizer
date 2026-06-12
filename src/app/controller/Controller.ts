import type { ChainModel, TxInfo } from '../model/ChainModel';
import type { Hud } from '../view/Hud';
import type { SceneView } from '../view/SceneView';

/**
 * # Controller — the C in MVC
 *
 * The only place where Model and View meet. It translates in both
 * directions and does nothing else:
 *
 *   DOM events  → Model actions   ("Mine clicked" → model.mine(...))
 *   Model events → View updates   ('block:mined' → view.finishMining(...))
 *
 * No blockchain rules live here (Model's job) and no rendering lives
 * here (View's job). If you deleted this file, the Model would still
 * pass its tests and the View would still render an empty world — they
 * just wouldn't know about each other.
 */
export class Controller {
	private static readonly WALLET_NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank'];

	private mining = false;
	private selectedTx: TxInfo | null = null;

	// Control panel inputs we need to read/update later.
	private fromSelect!: HTMLSelectElement;
	private toSelect!: HTMLSelectElement;
	private minerSelect!: HTMLSelectElement;
	private tamperSelect!: HTMLSelectElement;
	private amountInput!: HTMLInputElement;
	private mineButtons: HTMLButtonElement[] = [];

	constructor(
		private readonly model: ChainModel,
		private readonly view: SceneView,
		private readonly hud: Hud,
		root: HTMLElement,
	) {
		this.buildPanel(root);
		this.subscribeToModel();

		// Show what already exists (the genesis block).
		for (const block of model.blocks) this.view.addBlock(block);

		this.view.onTxSelected = (tx) => {
			this.selectedTx = tx;
			this.hud.setSelectedTx(tx, this.model.getConfirmations(tx.hash));
		};

		this.hud.logEvent('Welcome! Create a wallet, then mine a block to mint its first coins.', 'info');
	}

	// ── Model → View ───────────────────────────────────────────────────

	private subscribeToModel(): void {
		const { events } = this.model;

		events.on('wallet:created', ({ name, address }) => {
			this.refreshWalletSelects();
			this.hud.setWallets(this.model.balances);
			this.hud.logEvent(`Wallet "${name}" created (${address.slice(0, 8)}…). It owns nothing until it mines or is paid.`, 'info');
		});

		events.on('tx:added', (tx) => {
			this.view.mempool.add(tx);
			this.hud.logEvent(
				`${tx.fromName} signed a payment of ${tx.amount} to ${tx.toName} — signature checked, funds reserved, waiting in the mempool.`,
				'success',
			);
		});

		events.on('tx:rejected', ({ reason, fromName, toName, amount }) => {
			this.view.mempool.showRejection();
			this.hud.logEvent(`Payment ${fromName} → ${toName} (${amount}) refused. ${reason}`, 'error');
		});

		events.on('mining:started', ({ index, minerName, txCount }) => {
			this.view.startMining();
			this.hud.logEvent(
				`${minerName} starts mining block #${index} with ${txCount} transaction(s) — searching for a nonce whose hash starts with ${this.model.difficulty} zeros…`,
				'info',
			);
		});

		events.on('mining:progress', ({ nonce, hashAttempt }) => {
			this.hud.setMining({ nonce, hashAttempt });
		});

		events.on('block:mined', (block) => {
			this.view.finishMining(block);
			this.hud.setMining(null);
			this.hud.setWallets(this.model.balances);
			this.refreshTamperSelect();
			this.hud.logEvent(
				`Block #${block.index} mined after ${block.nonce} attempts! The coinbase pays the miner; every confirmation deepens older blocks.`,
				'success',
			);
			// A new block deepens the selected tx — refresh its confirmations.
			if (this.selectedTx) {
				this.hud.setSelectedTx(this.selectedTx, this.model.getConfirmations(this.selectedTx.hash));
			}
		});

		events.on('chain:tampered', ({ blockIndex }) => {
			this.hud.logEvent(
				`Block #${blockIndex} was silently edited in memory. Nothing breaks… until someone validates.`,
				'error',
			);
		});

		events.on('chain:validated', (report) => {
			this.view.applyValidation(report);
			this.hud.setChainStatus(report.valid);
			if (report.valid) {
				this.hud.logEvent('Validation: every hash, link, proof-of-work and signature checks out.', 'success');
			} else {
				const bad = report.blocks
					.filter((b) => !b.hashValid || !b.linkValid || !b.signaturesValid)
					.map((b) => `#${b.index}`)
					.join(', ');
				this.hud.logEvent(
					`Validation FAILED at block(s) ${bad}: a stored hash no longer matches its contents, so every link downstream breaks.`,
					'error',
				);
			}
		});
	}

	// ── DOM → Model ────────────────────────────────────────────────────

	private buildPanel(root: HTMLElement): void {
		const panel = document.createElement('div');
		panel.className = 'control-panel';
		panel.innerHTML = `
			<button data-ctl="wallet">＋ Create wallet</button>
			<span class="ctl-group">
				<select data-ctl="from"></select> →
				<select data-ctl="to"></select>
				<input data-ctl="amount" type="number" min="1" value="25" />
				<button data-ctl="send">Sign &amp; submit</button>
			</span>
			<span class="ctl-group">
				<select data-ctl="miner"></select>
				<button data-ctl="mine">⛏ Mine block</button>
			</span>
			<button data-ctl="double-spend">Attempt double-spend</button>
			<span class="ctl-group">
				<select data-ctl="tamper-block"></select>
				<button data-ctl="tamper">Tamper!</button>
			</span>
			<button data-ctl="validate">Validate chain</button>
			<label class="ctl-group">difficulty
				<input data-ctl="difficulty" type="range" min="1" max="4" step="1" value="${this.model.difficulty}" />
				<span data-ctl="difficulty-value">${this.model.difficulty}</span>
			</label>`;
		root.appendChild(panel);

		const get = <T extends HTMLElement>(sel: string): T => panel.querySelector<T>(`[data-ctl="${sel}"]`)!;
		this.fromSelect = get('from');
		this.toSelect = get('to');
		this.minerSelect = get('miner');
		this.tamperSelect = get('tamper-block');
		this.amountInput = get('amount');
		this.mineButtons = [get<HTMLButtonElement>('mine'), get<HTMLButtonElement>('double-spend')];
		this.refreshTamperSelect();

		get('wallet').addEventListener('click', () => this.createWallet());
		get('send').addEventListener('click', () => this.submitTransaction());
		get('mine').addEventListener('click', () => void this.mine());
		get('double-spend').addEventListener('click', () => this.attemptDoubleSpend());
		get('tamper').addEventListener('click', () => this.tamper());
		get('validate').addEventListener('click', () => this.model.validateChain());

		const slider = get<HTMLInputElement>('difficulty');
		slider.addEventListener('input', () => {
			this.model.difficulty = Number(slider.value);
			get('difficulty-value').textContent = slider.value;
			this.hud.logEvent(
				`Difficulty set to ${slider.value} — each extra zero makes mining ~16× more work, with verification still instant.`,
				'info',
			);
		});
	}

	private createWallet(): void {
		const taken = new Set(this.model.walletNames);
		const name =
			Controller.WALLET_NAMES.find((n) => !taken.has(n)) ?? `Wallet ${taken.size + 1}`;
		this.model.createWallet(name);
	}

	private submitTransaction(): void {
		const from = this.fromSelect.value;
		const to = this.toSelect.value;
		const amount = Number(this.amountInput.value);
		if (!from || !to) {
			this.hud.logEvent('Create at least two wallets first.', 'error');
			return;
		}
		if (from === to) {
			this.hud.logEvent('Pick two different wallets — paying yourself proves nothing.', 'error');
			return;
		}
		this.model.submitTransaction(from, to, amount);
	}

	private async mine(minerOverride?: string): Promise<void> {
		const miner = minerOverride ?? this.minerSelect.value;
		if (!miner) {
			this.hud.logEvent('Create a wallet first — someone has to collect the reward.', 'error');
			return;
		}
		if (this.mining) return; // one PoW search at a time
		this.mining = true;
		this.mineButtons.forEach((b) => (b.disabled = true));
		try {
			await this.model.mine(miner);
		} finally {
			this.mining = false;
			this.mineButtons.forEach((b) => (b.disabled = false));
		}
	}

	/**
	 * The pre-built lesson: sign TWO transactions that each spend the
	 * sender's full balance. Both signatures are valid; the mempool's
	 * balance check (which counts pending spends) refuses the second.
	 */
	private attemptDoubleSpend(): void {
		const funded = this.model.balances
			.filter((w) => w.balance > 0)
			.sort((a, b) => b.balance - a.balance)[0];
		const other = this.model.balances.find((w) => w.name !== funded?.name);
		if (!funded || !other) {
			this.hud.logEvent('Double-spend needs a funded wallet and a victim: create two wallets and mine first.', 'error');
			return;
		}
		this.hud.logEvent(
			`${funded.name} signs TWO payments of ${funded.balance} each — the whole balance, twice. Watch the second one.`,
			'info',
		);
		this.model.submitTransaction(funded.name, other.name, funded.balance);
		this.model.submitTransaction(funded.name, other.name, funded.balance);
	}

	private tamper(): void {
		const index = Number(this.tamperSelect.value);
		if (!Number.isInteger(index) || index < 1) {
			this.hud.logEvent('Mine at least one block first — genesis is hard-coded and has no transactions.', 'error');
			return;
		}
		this.model.tamperBlock(index);
		// Validate right away so the damage shows up as red links downstream.
		this.model.validateChain();
	}

	// ── select-box housekeeping ────────────────────────────────────────

	private refreshWalletSelects(): void {
		const names = this.model.walletNames;
		for (const select of [this.fromSelect, this.toSelect, this.minerSelect]) {
			const previous = select.value;
			select.innerHTML = names.map((n) => `<option value="${n}">${n}</option>`).join('');
			if (names.includes(previous)) select.value = previous;
		}
		// Default to a sensible from ≠ to pairing.
		if (names.length > 1 && this.fromSelect.value === this.toSelect.value) {
			this.toSelect.selectedIndex = (this.fromSelect.selectedIndex + 1) % names.length;
		}
	}

	private refreshTamperSelect(): void {
		const mineable = this.model.blocks.filter((b) => b.index > 0);
		this.tamperSelect.innerHTML =
			mineable.length === 0
				? '<option value="">no blocks</option>'
				: mineable.map((b) => `<option value="${b.index}">block #${b.index}</option>`).join('');
	}
}
