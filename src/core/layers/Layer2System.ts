import type { Wallet } from '../Wallet';
import type { TypedEventEmitter } from '../events';
import type { ChainEvents, TxInfo } from '../events/chainEvents';
import type { Address, Hex } from '../types';

/**
 * # Layer 2 — the contracts
 *
 * An L2 is where activity happens; its L1 parent is the settlement
 * anchor and the courtroom. These types pin that relationship down:
 * the L2 never holds the L1 model — it talks through the ParentL1
 * facade (inject a settlement, count confirmations, read balances),
 * and it tells its own story through a typed event vocabulary the
 * page's presenter renders.
 */

/** What an L2 may ask of its parent chain. Implemented by thin app-layer
 *  adapters over the running L1 models (powParent / posParent). */
export interface ParentL1 {
	readonly events: TypedEventEmitter<ChainEvents>;
	/** Inject a settlement transaction into the L1 mempool; returns its
	 *  hash. L1 confirmations are the L2's ONLY clock for windows. */
	submitSettlement(request: SettlementRequest): Hex;
	getConfirmations(txHash: Hex): number;
	getBalance(address: Address): number;
	/** Read a transaction's on-chain data payload — data availability:
	 *  if it was posted, anyone can fetch and re-execute it. */
	getTransactionMemo(txHash: Hex): string | undefined;
}

export interface SettlementRequest {
	/** labels the special tx for views/tickers; covered by the tx hash */
	readonly kind: 'channel-open' | 'channel-close' | 'justice' | 'batch' | 'deposit' | 'withdrawal';
	/** the signing wallet (the L2 holds settlement keys: channel vaults,
	 *  the sequencer, bridge actors) */
	readonly from: Wallet;
	readonly to: Address;
	readonly amount: number;
	readonly memo?: string;
}

export interface Layer2System<E> {
	readonly kind: 'state-channel' | 'optimistic-rollup';
	readonly events: TypedEventEmitter<E>;
	/** subscribe to parent blocks and begin the L2's own activity */
	start(): void;
	stop(): void;
}

// ── Lightning vocabulary ─────────────────────────────────────────────

export interface ChannelSnapshot {
	readonly channelId: string;
	readonly a: string;
	readonly b: string;
	readonly balanceA: number;
	readonly balanceB: number;
	readonly stateNumber: number;
	readonly status: 'funding' | 'open' | 'closing' | 'disputed' | 'closed';
}

export interface ChannelEvents {
	'channel:funding-pending': { channelId: string; a: string; b: string; fundingTxHash: Hex };
	'channel:opened': { channelId: string; a: string; b: string; balanceA: number; balanceB: number };
	/** an OFF-chain state update — the L1 never hears about these */
	'channel:updated': { channelId: string; stateNumber: number; balanceA: number; balanceB: number };
	'payment:routed': { paymentId: number; path: readonly string[]; amount: number; feePerHop: number };
	'payment:hop': { paymentId: number; hop: number; phase: 'lock' | 'reveal' };
	'payment:failed': { paymentId: number; reason: string; atHop: number };
	'channel:close-pending': { channelId: string; settlementTxHash: Hex };
	'channel:closed': { channelId: string; finalA: number; finalB: number };
	'channel:disputed': {
		channelId: string;
		cheater: string;
		broadcastStateNumber: number;
		latestStateNumber: number;
		windowBlocks: number;
	};
	'dispute:tick': { channelId: string; blocksLeft: number };
	'dispute:resolved': {
		channelId: string;
		outcome: 'justice' | 'cheat-succeeded';
		penaltyTo?: string;
	};
}

// ── Rollup vocabulary ────────────────────────────────────────────────

export interface RollupEvents {
	'l2tx:soft-confirmed': { tx: TxInfo; l2Block: number };
	'l2block:produced': { index: number; txCount: number };
	/** NOTE: fraud is never flagged here — verifiers must DISCOVER it by
	 *  re-executing the posted data */
	'batch:posted': {
		batchId: number;
		l2Blocks: readonly [number, number];
		txCount: number;
		preStateRoot: Hex;
		postStateRoot: Hex;
		l1TxHash: Hex;
	};
	'batch:confirmed': { batchId: number };
	'batch:window-tick': { batchId: number; blocksLeft: number; windowBlocks: number };
	'batch:challenged': { batchId: number; verifier: string; reason: 'state-root-mismatch' };
	'batch:reverted': { batchId: number; revertedTxHashes: readonly Hex[]; rolledBackToL2Block: number };
	/** valid:false = an unchallenged fraud just became final — the trust
	 *  assumption of optimistic rollups, stated out loud */
	'batch:finalized': { batchId: number; valid: boolean };
	'withdrawal:requested': { id: number; account: string; amount: number; batchId: number };
	'withdrawal:ready': { id: number };
	'withdrawal:completed': { id: number; l1TxHash: Hex };
	'deposit:requested': { id: number; account: string; amount: number; l1TxHash: Hex };
	'deposit:credited': { id: number };
}
