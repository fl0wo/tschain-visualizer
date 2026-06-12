import { Blockchain } from '../../core/Blockchain';
import { Mempool } from '../../core/Mempool';
import { Transaction } from '../../core/Transaction';
import { Wallet } from '../../core/Wallet';
import { TypedEventEmitter } from '../../core/events';
import type { Address, Hex } from '../../core/types';

/**
 * Plain-data snapshots handed to the View. The View must never hold core
 * objects (it could mutate them, and it would couple rendering to domain
 * internals) — it gets these frozen DTOs instead.
 */
export interface TxInfo {
	readonly hash: Hex;
	readonly from: Address | null;
	readonly to: Address;
	readonly fromName: string;
	readonly toName: string;
	readonly amount: number;
	readonly nonce: number;
	readonly coinbase: boolean;
	readonly signatureValid: boolean;
}

export interface BlockInfo {
	readonly index: number;
	readonly hash: Hex;
	readonly previousHash: Hex;
	readonly nonce: number;
	readonly timestamp: number;
	readonly transactions: readonly TxInfo[];
}

/** Per-block integrity breakdown — lets the View color each link. */
export interface BlockIntegrity {
	readonly index: number;
	/** stored hash still matches the block's current contents */
	readonly hashValid: boolean;
	/** previousHash still matches the actual parent hash */
	readonly linkValid: boolean;
	/** hash meets the proof-of-work difficulty */
	readonly powValid: boolean;
	/** every non-coinbase tx signature verifies */
	readonly signaturesValid: boolean;
}

export interface ValidationReport {
	readonly valid: boolean;
	readonly blocks: readonly BlockIntegrity[];
}

/** Every announcement the Model can make. Name → payload type. */
export interface ChainEvents {
	'wallet:created': { name: string; address: Address };
	'tx:added': TxInfo;
	'tx:rejected': { reason: string; fromName: string; toName: string; amount: number };
	'mining:started': { index: number; minerName: string; txCount: number };
	'mining:progress': { index: number; nonce: number; hashAttempt: Hex };
	'block:mined': BlockInfo;
	'chain:tampered': { blockIndex: number };
	'chain:validated': ValidationReport;
}

/**
 * # ChainModel — the M in MVC
 *
 * Wraps the Phase 1 core (Blockchain + Mempool + Wallets) behind a small
 * action API and broadcasts every outcome as a typed event. Note what is
 * absent: no three.js, no DOM, not even a console.log. The Model doesn't
 * know a visualization exists — which is exactly why the core stayed
 * testable and why a different View (text UI, React, …) could be swapped
 * in without touching this file.
 *
 * Errors deserve a special note: user-triggered failures (a rejected
 * transaction) are *outcomes*, not exceptions. The Model catches them
 * and emits 'tx:rejected' with the human-readable reason, because in an
 * educational tool the rejection IS the lesson.
 */
export class ChainModel {
	readonly events = new TypedEventEmitter<ChainEvents>();
	private readonly chain: Blockchain;
	private readonly mempool: Mempool;
	private readonly wallets = new Map<string, Wallet>();

	constructor(difficulty = 2) {
		this.chain = new Blockchain(difficulty);
		this.mempool = new Mempool(this.chain);
	}

	// ── wallets ────────────────────────────────────────────────────────

	createWallet(name: string): { name: string; address: Address } {
		if (this.wallets.has(name)) {
			throw new Error(`Wallet "${name}" already exists`);
		}
		const wallet = new Wallet();
		this.wallets.set(name, wallet);
		const info = { name, address: wallet.address };
		this.events.emit('wallet:created', info);
		return info;
	}

	get walletNames(): string[] {
		return [...this.wallets.keys()];
	}

	getBalance(address: Address): number {
		return this.chain.getBalance(address);
	}

	/** name → balance, for the HUD. */
	get balances(): Array<{ name: string; address: Address; balance: number }> {
		return [...this.wallets.entries()].map(([name, wallet]) => ({
			name,
			address: wallet.address,
			balance: this.chain.getBalance(wallet.address),
		}));
	}

	// ── transactions ───────────────────────────────────────────────────

	/**
	 * Builds, signs and submits a payment. The nonce is computed for the
	 * user (chain nonce + their txs already pending) — in a real wallet
	 * app this bookkeeping is also hidden from the human.
	 * Returns true if accepted; on rejection emits the reason and
	 * returns false rather than throwing at the UI.
	 */
	submitTransaction(fromName: string, toName: string, amount: number): boolean {
		const from = this.requireWallet(fromName);
		const to = this.requireWallet(toName);

		const pendingFromSender = this.mempool.pending.filter((tx) => tx.from === from.address).length;
		const tx = new Transaction({
			from: from.address,
			to: to.address,
			amount,
			nonce: this.chain.getNonce(from.address) + pendingFromSender,
			timestamp: Date.now(),
		});
		from.sign(tx);

		try {
			this.mempool.addTransaction(tx);
		} catch (error) {
			this.events.emit('tx:rejected', {
				reason: (error as Error).message,
				fromName,
				toName,
				amount,
			});
			return false;
		}
		this.events.emit('tx:added', this.toTxInfo(tx));
		return true;
	}

	get pendingTransactions(): TxInfo[] {
		return this.mempool.pending.map((tx) => this.toTxInfo(tx));
	}

	// ── mining ─────────────────────────────────────────────────────────

	/**
	 * Mines the pending pool into a block, narrating progress so the View
	 * can spin the live nonce counter. `yieldEvery` is small: smoother
	 * animation and a responsive UI matter more here than raw hash rate.
	 */
	async mine(minerName: string, yieldEvery = 300): Promise<BlockInfo> {
		const miner = this.requireWallet(minerName);
		const nextIndex = this.chain.latestBlock.index + 1;
		this.events.emit('mining:started', {
			index: nextIndex,
			minerName,
			txCount: this.mempool.pending.length + 1, // +1 coinbase
		});

		const block = await this.mempool.minePendingTransactions(miner.address, {
			yieldEvery,
			onProgress: (nonce, hashAttempt) =>
				this.events.emit('mining:progress', { index: nextIndex, nonce, hashAttempt }),
		});

		const info = this.toBlockInfo(block.index);
		this.events.emit('block:mined', info);
		return info;
	}

	// ── chain inspection & tampering ───────────────────────────────────

	get blocks(): BlockInfo[] {
		return this.chain.blocks.map((_, i) => this.toBlockInfo(i));
	}

	getConfirmations(txHash: Hex): number {
		return this.chain.getConfirmations(txHash);
	}

	get difficulty(): number {
		return this.chain.difficulty;
	}

	set difficulty(value: number) {
		this.chain.difficulty = value;
	}

	/**
	 * The "attacker" button: rewrites the first transaction of a past
	 * block to a huge amount, keeping the (now wrong) old signature and
	 * leaving the stored hash stale — exactly what an in-memory edit of
	 * history looks like. The chain doesn't notice until validated:
	 * tampering is silent, *detection* is what the validator does.
	 */
	tamperBlock(blockIndex: number): void {
		const block = this.chain.blocks[blockIndex];
		if (!block) throw new Error(`No block #${blockIndex}`);
		const victim = block.transactions[0];
		if (!victim) throw new Error(`Block #${blockIndex} has no transactions to tamper with`);

		block.transactions[0] = new Transaction({
			from: victim.from,
			to: victim.to,
			amount: 999_999,
			nonce: victim.nonce,
			timestamp: victim.timestamp,
			signature: victim.signature, // old signature: no longer covers the data
		});
		this.events.emit('chain:tampered', { blockIndex });
	}

	/**
	 * Re-checks the whole chain and reports integrity per block, so the
	 * View can paint exactly which links broke (and everything downstream
	 * of an edit shows the cascade).
	 */
	validateChain(): ValidationReport {
		const blocks: BlockIntegrity[] = this.chain.blocks.map((block, i) => {
			const parent = i > 0 ? this.chain.blocks[i - 1]! : null;
			return {
				index: block.index,
				hashValid: block.hash === block.calculateHash(),
				// Compare against the parent's RECALCULATED hash, not its
				// stored one: if the parent's contents were edited, every
				// child pointing at the old hash is the broken link. This
				// is what makes tamper damage cascade downstream.
				linkValid: parent === null || block.previousHash === parent.calculateHash(),
				powValid: i === 0 || block.hash.startsWith('0'.repeat(this.chain.difficulty)),
				signaturesValid: block.transactions.every((tx) => tx.isCoinbase() || Wallet.verify(tx)),
			};
		});
		const report: ValidationReport = {
			valid: this.chain.isChainValid(),
			blocks,
		};
		this.events.emit('chain:validated', report);
		return report;
	}

	// ── helpers ────────────────────────────────────────────────────────

	private requireWallet(name: string): Wallet {
		const wallet = this.wallets.get(name);
		if (!wallet) throw new Error(`Unknown wallet "${name}"`);
		return wallet;
	}

	private nameOf(address: Address | null): string {
		if (address === null) return 'coinbase';
		for (const [name, wallet] of this.wallets) {
			if (wallet.address === address) return name;
		}
		return `${address.slice(0, 8)}…`;
	}

	private toTxInfo(tx: Transaction): TxInfo {
		return {
			hash: tx.hash(),
			from: tx.from,
			to: tx.to,
			fromName: this.nameOf(tx.from),
			toName: this.nameOf(tx.to),
			amount: tx.amount,
			nonce: tx.nonce,
			coinbase: tx.isCoinbase(),
			signatureValid: tx.isCoinbase() ? true : Wallet.verify(tx),
		};
	}

	private toBlockInfo(index: number): BlockInfo {
		const block = this.chain.blocks[index];
		if (!block) throw new Error(`No block #${index}`);
		return {
			index: block.index,
			hash: block.hash,
			previousHash: block.previousHash,
			nonce: block.nonce,
			timestamp: block.timestamp,
			transactions: block.transactions.map((tx) => this.toTxInfo(tx)),
		};
	}
}
