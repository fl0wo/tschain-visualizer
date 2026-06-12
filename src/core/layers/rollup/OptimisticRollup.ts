import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { Transaction } from '../../Transaction';
import { Wallet } from '../../Wallet';
import { TypedEventEmitter } from '../../events';
import type { TxInfo } from '../../events/chainEvents';
import type { Address, Hex } from '../../types';
import type { Layer2System, ParentL1, RollupEvents } from '../Layer2System';

/**
 * # OptimisticRollup — Base-style, simplified but honest
 *
 * The batch + challenge-window model: a SEQUENCER orders L2
 * transactions instantly (soft confirmation — it is a single operator,
 * trusted for liveness only; real systems add an L1 force-inclusion
 * escape hatch for when it goes down), periodically compressing them
 * into a batch posted as ONE transaction on the L1 parent. "Optimistic"
 * means the L1 accepts the claimed result without re-executing it —
 * unless someone proves fraud within the challenge window.
 *
 * Every state mutation since the last batch is JOURNALED, and the batch
 * memo carries { preState, journal }: that is the data-availability
 * property — anyone can fetch the batch FROM THE CHAIN and re-execute
 * it (`reExecuteBatch`). A fraudulent batch is one whose posted state
 * root doesn't match its own journal (e.g. the sequencer minted itself
 * funds off the books); a verifier that re-executes catches it, the
 * batch and everything after revert, and the sequencer's bond is
 * slashed. With verifiers off, the fraud FINALIZES — optimistic
 * rollups are safe only while at least one honest party watches.
 *
 * Simplifications, stated: state roots are sha256 of the serialized
 * state (real ones are merkle roots so single accounts can be proven);
 * we inline the pre-state in each batch so one batch is independently
 * checkable (real verifiers replay from genesis); real fraud proofs
 * are interactive bisection games, not whole-batch re-execution.
 */

interface L2Account {
	balance: number;
	nonce: number;
}

type JournalItem =
	| { t: 'tx'; from: Address; to: Address; amount: number; nonce: number; timestamp: number; signature: Hex }
	| { t: 'deposit'; to: Address; amount: number }
	| { t: 'withdraw'; from: Address; amount: number };

interface Batch {
	id: number;
	l1TxHash: Hex;
	preStateSerialized: string;
	postStateRoot: Hex;
	txHashes: Hex[];
	status: 'posted' | 'confirmed' | 'finalized' | 'reverted';
	blocksLeft: number;
	/** internal only — the world must DISCOVER fraud by re-executing */
	fraudulent: boolean;
}

export interface RollupOptions {
	sequencer: Wallet;
	verifierOn: boolean;
	challengeWindowBlocks: number;
	sequencerBond: number;
	depositConfirmations: number;
}

/** where slashed bonds go to die */
const BURN_ADDRESS = 'e'.repeat(64);
/** the L1 inbox the sequencer posts batches to */
const BATCH_INBOX = 'f'.repeat(64);

export class OptimisticRollup implements Layer2System<RollupEvents> {
	readonly kind = 'optimistic-rollup' as const;
	readonly events = new TypedEventEmitter<RollupEvents>();
	/** the cheat-game switch: is anyone re-executing batches? */
	verifierOn: boolean;

	private readonly state = new Map<Address, L2Account>();
	private journal: JournalItem[] = [];
	private softTxHashes: Hex[] = [];
	private lastBatchState = '{}';
	private readonly batches: Batch[] = [];
	private l2BlockCount = 0;
	private lastTx: Hex | null = null;
	private nextFraud = false;

	private readonly deposits: Array<{ id: number; wallet: Wallet; amount: number; l1TxHash: Hex; credited: boolean }> = [];
	private readonly withdrawals: Array<{
		id: number;
		wallet: Wallet;
		amount: number;
		batchId: number | null;
		status: 'pending' | 'ready' | 'completed' | 'cancelled';
		payoutTxHash?: Hex;
	}> = [];
	private idCounter = 0;

	/** holds bridged L1 funds while they live on the L2 */
	private readonly bridgeVault = new Wallet();
	private unsubscribe: (() => void) | null = null;

	constructor(
		private readonly parent: ParentL1,
		private readonly options: RollupOptions,
	) {
		this.verifierOn = options.verifierOn;
		this.lastBatchState = this.serializeState();
	}

	get sequencerAddress(): Address {
		return this.options.sequencer.address;
	}

	start(): void {
		this.unsubscribe = this.parent.events.on('block:mined', () => this.onParentBlock());
	}

	stop(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	// ── the fast lane ──────────────────────────────────────────────────

	/** Same Transaction, same signature rules as the L1 — reused, not forked. */
	submitL2Tx(from: Wallet, to: Address, amount: number): boolean {
		const account = this.account(from.address);
		if (account.balance < amount) return false;
		const tx = new Transaction({
			from: from.address,
			to,
			amount,
			nonce: account.nonce,
			timestamp: Date.now(),
			kind: 'transfer',
		});
		from.sign(tx);
		if (!Wallet.verify(tx)) return false;

		account.balance -= amount;
		account.nonce++;
		this.account(to).balance += amount;
		this.journal.push({
			t: 'tx',
			from: tx.from!,
			to: tx.to,
			amount: tx.amount,
			nonce: tx.nonce,
			timestamp: tx.timestamp,
			signature: tx.signature!,
		});
		const hash = tx.hash();
		this.softTxHashes.push(hash);
		this.lastTx = hash;
		this.l2BlockCount++;
		this.events.emit('l2tx:soft-confirmed', { tx: this.toTxInfo(tx), l2Block: this.l2BlockCount });
		this.events.emit('l2block:produced', { index: this.l2BlockCount, txCount: 1 });
		return true;
	}

	// ── batching ───────────────────────────────────────────────────────

	/** Compress everything since the last batch into ONE L1 transaction. */
	postBatch(): { batchId: number; l1TxHash: Hex; postStateRoot: Hex } | null {
		if (this.journal.length === 0) return null;
		const id = this.batches.length + 1;
		const memo = JSON.stringify({ preState: this.lastBatchState, journal: this.journal });
		const postStateRoot = this.stateRoot();
		const l1TxHash = this.parent.submitSettlement({
			kind: 'batch',
			from: this.options.sequencer,
			to: BATCH_INBOX,
			amount: 1, // the posting stake; real systems pay L1 gas here
			memo,
		});
		const batch: Batch = {
			id,
			l1TxHash,
			preStateSerialized: this.lastBatchState,
			postStateRoot,
			txHashes: [...this.softTxHashes],
			status: 'posted',
			blocksLeft: this.options.challengeWindowBlocks,
			fraudulent: this.nextFraud,
		};
		this.batches.push(batch);
		this.events.emit('batch:posted', {
			batchId: id,
			l2Blocks: [Math.max(1, this.l2BlockCount - this.journal.length + 1), this.l2BlockCount],
			txCount: this.softTxHashes.length,
			preStateRoot: this.rootOf(this.lastBatchState),
			postStateRoot,
			l1TxHash,
		});
		// assign pending withdrawals to this batch — their clock is ITS window
		for (const w of this.withdrawals) {
			if (w.status === 'pending' && w.batchId === null) w.batchId = id;
		}
		this.lastBatchState = this.serializeState();
		this.journal = [];
		this.softTxHashes = [];
		this.nextFraud = false;
		return { batchId: id, l1TxHash, postStateRoot };
	}

	/**
	 * The fraud scenario: mint the sequencer funds OFF the journal, then
	 * post. The posted root won't match re-execution of the posted data —
	 * exactly what a verifier can prove.
	 */
	postFraudulentBatch(): { batchId: number; l1TxHash: Hex } | null {
		this.account(this.sequencerAddress).balance += this.options.sequencerBond;
		this.nextFraud = true;
		// fraud needs SOMETHING in the journal to post alongside
		if (this.journal.length === 0) {
			this.journal.push({ t: 'deposit', to: this.sequencerAddress, amount: 0 });
		}
		const posted = this.postBatch();
		return posted ? { batchId: posted.batchId, l1TxHash: posted.l1TxHash } : null;
	}

	// ── the bridge ─────────────────────────────────────────────────────

	/** L1 → L2: lock on the parent, credit after it confirms. */
	deposit(l1Wallet: Wallet, amount: number): number {
		const id = ++this.idCounter;
		const l1TxHash = this.parent.submitSettlement({
			kind: 'deposit',
			from: l1Wallet,
			to: this.bridgeVault.address,
			amount,
			memo: `deposit#${id}`,
		});
		this.deposits.push({ id, wallet: l1Wallet, amount, l1TxHash, credited: false });
		this.events.emit('deposit:requested', {
			id,
			account: this.shortName(l1Wallet.address),
			amount,
			l1TxHash,
		});
		return id;
	}

	/** L2 → L1: burn instantly, but funds are only `ready` on the L1
	 *  after this withdrawal's batch FINALIZES — the famous wait. */
	withdraw(wallet: Wallet, amount: number): number | null {
		const account = this.account(wallet.address);
		if (account.balance < amount) return null;
		account.balance -= amount;
		this.journal.push({ t: 'withdraw', from: wallet.address, amount });
		const id = ++this.idCounter;
		this.withdrawals.push({ id, wallet, amount, batchId: null, status: 'pending' });
		this.events.emit('withdrawal:requested', {
			id,
			account: this.shortName(wallet.address),
			amount,
			batchId: this.batches.length + 1,
		});
		return id;
	}

	// ── queries ────────────────────────────────────────────────────────

	l2Balance(address: Address): number {
		return this.state.get(address)?.balance ?? 0;
	}

	lastTxHash(): Hex | null {
		return this.lastTx;
	}

	finalityOf(txHash: Hex): 'soft' | 'posted' | 'finalized' {
		for (const batch of this.batches) {
			if (!batch.txHashes.includes(txHash)) continue;
			if (batch.status === 'finalized') return 'finalized';
			if (batch.status === 'posted' || batch.status === 'confirmed') return 'posted';
		}
		return 'soft';
	}

	batchList(): Array<{ id: number; status: Batch['status']; blocksLeft: number; txCount: number }> {
		return this.batches.map((b) => ({
			id: b.id,
			status: b.status,
			blocksLeft: b.blocksLeft,
			txCount: b.txHashes.length,
		}));
	}

	// ── parent-block clock ─────────────────────────────────────────────

	private onParentBlock(): void {
		// deposits credit once their L1 tx has enough confirmations
		for (const deposit of this.deposits) {
			if (deposit.credited) continue;
			if (this.parent.getConfirmations(deposit.l1TxHash) >= this.options.depositConfirmations) {
				deposit.credited = true;
				this.account(deposit.wallet.address).balance += deposit.amount;
				this.journal.push({ t: 'deposit', to: deposit.wallet.address, amount: deposit.amount });
				this.events.emit('deposit:credited', { id: deposit.id });
			}
		}

		for (const batch of this.batches) {
			if (batch.status === 'posted' && this.parent.getConfirmations(batch.l1TxHash) >= 1) {
				batch.status = 'confirmed';
				this.events.emit('batch:confirmed', { batchId: batch.id });
				// the verifier strikes the moment the data is on-chain
				if (this.verifierOn) this.verifyAndMaybeChallenge(batch);
				// either way the window starts at the NEXT block — the
				// confirming block itself is not "time elapsed"
				continue;
			}
			if (batch.status === 'confirmed') {
				batch.blocksLeft--;
				this.events.emit('batch:window-tick', {
					batchId: batch.id,
					blocksLeft: batch.blocksLeft,
					windowBlocks: this.options.challengeWindowBlocks,
				});
				if (batch.blocksLeft <= 0) {
					batch.status = 'finalized';
					this.events.emit('batch:finalized', { batchId: batch.id, valid: !batch.fraudulent });
					this.releaseWithdrawals(batch.id);
				}
			}
		}

		// withdrawal payouts complete once their L1 settlement confirms
		for (const w of this.withdrawals) {
			if (w.status === 'ready' && w.payoutTxHash && this.parent.getConfirmations(w.payoutTxHash) >= 1) {
				w.status = 'completed';
				this.events.emit('withdrawal:completed', { id: w.id, l1TxHash: w.payoutTxHash });
			}
		}
	}

	/** Data availability in action: fetch the batch FROM THE CHAIN,
	 *  re-execute, compare roots. Returns true if it challenged. */
	private verifyAndMaybeChallenge(batch: Batch): boolean {
		const memo = this.parent.getTransactionMemo(batch.l1TxHash);
		if (memo === undefined) return false;
		const derived = reExecuteBatch(memo);
		if (derived === batch.postStateRoot) return false;

		this.events.emit('batch:challenged', {
			batchId: batch.id,
			verifier: 'Verifier',
			reason: 'state-root-mismatch',
		});

		// revert THIS batch and everything after: state snaps back to the
		// batch's pre-state; soft txs since then are gone with it
		const revertedTxHashes = [
			...this.batches.filter((b) => b.id >= batch.id).flatMap((b) => b.txHashes),
			...this.softTxHashes,
		];
		this.restoreState(batch.preStateSerialized);
		this.lastBatchState = batch.preStateSerialized;
		this.journal = [];
		this.softTxHashes = [];
		for (const b of this.batches) {
			if (b.id >= batch.id && b.status !== 'reverted') b.status = 'reverted';
		}
		for (const w of this.withdrawals) {
			if (w.batchId !== null && w.batchId >= batch.id && w.status === 'pending') w.status = 'cancelled';
		}

		// the sequencer pays for the lie: bond slashed to the burn address
		try {
			this.parent.submitSettlement({
				kind: 'justice',
				from: this.options.sequencer,
				to: BURN_ADDRESS,
				amount: this.options.sequencerBond,
				memo: `slash:batch#${batch.id}`,
			});
		} catch {
			// an insolvent sequencer just goes broke — the revert stands
		}

		this.events.emit('batch:reverted', {
			batchId: batch.id,
			revertedTxHashes,
			rolledBackToL2Block: this.l2BlockCount - revertedTxHashes.length,
		});
		return true;
	}

	private releaseWithdrawals(batchId: number): void {
		for (const w of this.withdrawals) {
			if (w.batchId !== batchId || w.status !== 'pending') continue;
			w.status = 'ready';
			this.events.emit('withdrawal:ready', { id: w.id });
			w.payoutTxHash = this.parent.submitSettlement({
				kind: 'withdrawal',
				from: this.bridgeVault,
				to: w.wallet.address,
				amount: w.amount,
				memo: `withdrawal#${w.id}`,
			});
		}
	}

	// ── state helpers ──────────────────────────────────────────────────

	private account(address: Address): L2Account {
		let account = this.state.get(address);
		if (!account) {
			account = { balance: 0, nonce: 0 };
			this.state.set(address, account);
		}
		return account;
	}

	private serializeState(): string {
		const entries = [...this.state.entries()]
			.filter(([, acc]) => acc.balance !== 0 || acc.nonce !== 0)
			.sort(([a], [b]) => a.localeCompare(b));
		return JSON.stringify(entries);
	}

	private restoreState(serialized: string): void {
		this.state.clear();
		for (const [address, account] of JSON.parse(serialized) as Array<[Address, L2Account]>) {
			this.state.set(address, { ...account });
		}
	}

	private stateRoot(): Hex {
		return this.rootOf(this.serializeState());
	}

	private rootOf(serialized: string): Hex {
		return bytesToHex(sha256(utf8ToBytes(serialized)));
	}

	private shortName(address: Address): string {
		return `0x${address.slice(0, 6)}…`;
	}

	private toTxInfo(tx: Transaction): TxInfo {
		return {
			hash: tx.hash(),
			from: tx.from,
			to: tx.to,
			fromName: this.shortName(tx.from!),
			toName: this.shortName(tx.to),
			amount: tx.amount,
			fee: tx.fee,
			nonce: tx.nonce,
			coinbase: false,
			signatureValid: true,
			kind: tx.kind,
		};
	}
}

/**
 * Pure re-execution of a posted batch: parse { preState, journal },
 * apply every journaled item (verifying tx signatures), return the
 * resulting state root. This is the verifier's whole job — possible
 * ONLY because the data lives on the L1.
 */
export function reExecuteBatch(memo: string): Hex {
	const { preState, journal } = JSON.parse(memo) as { preState: string; journal: JournalItem[] };
	const state = new Map<Address, L2Account>();
	for (const [address, account] of JSON.parse(preState) as Array<[Address, L2Account]>) {
		state.set(address, { ...account });
	}
	const account = (address: Address): L2Account => {
		let acc = state.get(address);
		if (!acc) {
			acc = { balance: 0, nonce: 0 };
			state.set(address, acc);
		}
		return acc;
	};

	for (const item of journal) {
		if (item.t === 'deposit') {
			account(item.to).balance += item.amount;
		} else if (item.t === 'withdraw') {
			account(item.from).balance -= item.amount;
		} else {
			const tx = new Transaction({
				from: item.from,
				to: item.to,
				amount: item.amount,
				nonce: item.nonce,
				timestamp: item.timestamp,
				kind: 'transfer',
				signature: item.signature,
			});
			if (!Wallet.verify(tx)) continue; // an unsigned mutation simply doesn't count
			account(item.from).balance -= item.amount;
			account(item.from).nonce++;
			account(item.to).balance += item.amount;
		}
	}

	const entries = [...state.entries()]
		.filter(([, acc]) => acc.balance !== 0 || acc.nonce !== 0)
		.sort(([a], [b]) => a.localeCompare(b));
	return bytesToHex(sha256(utf8ToBytes(JSON.stringify(entries))));
}
