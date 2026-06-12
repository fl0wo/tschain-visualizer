import type { Address, Hex } from '../types';

/**
 * # The chain event vocabulary
 *
 * The single contract between whatever PRODUCES chain activity (the
 * simulation engine, or a live adapter streaming a real network) and
 * whatever CONSUMES it (the Model facades, the Controller, the View).
 * Lives in core so data sources can speak it without touching app code.
 *
 * The vocabulary is frozen for consumers; live data extends it only
 * ADDITIVELY: optional BlockInfo fields a simulated block simply leaves
 * unset, plus a handful of live-only events (projection, stats, reorg,
 * source status) that simulated pages never emit.
 */

/** Plain-data transaction snapshot handed to the View. */
export interface TxInfo {
	readonly hash: Hex;
	readonly from: Address | null;
	readonly to: Address;
	readonly fromName: string;
	readonly toName: string;
	readonly amount: number;
	/** miner tip paid by the sender on top of `amount` */
	readonly fee: number;
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
	/** simulated blocks carry full transactions; live blocks carry counts */
	readonly transactions: readonly TxInfo[];

	// ── additive, live-data fields (absent on simulated blocks) ──
	/** real networks: thousands of txs → render density, not actors */
	readonly txCount?: number;
	/** mining pool name (live) — fills the "who mined it" slot */
	readonly minerName?: string;
	/** total coinbase value (subsidy + fees), in display units (BTC) */
	readonly rewardTotal?: number;
	/** total fees collected in the block, display units */
	readonly fees?: number;
	/** median fee rate, sat/vB */
	readonly medianFee?: number;
	readonly difficulty?: number;
	readonly weight?: number;
	/** part of the initial history backfill — render without animations */
	readonly backfill?: boolean;
	readonly source?: 'simulated' | 'live';
}

/** Per-block integrity breakdown — lets the View color each link. */
export interface BlockIntegrity {
	readonly index: number;
	readonly hashValid: boolean;
	readonly linkValid: boolean;
	readonly powValid: boolean;
	readonly signaturesValid: boolean;
}

export interface ValidationReport {
	readonly valid: boolean;
	readonly blocks: readonly BlockIntegrity[];
}

/** One templated next-block from a live mempool projection. */
export interface ProjectedBlock {
	readonly nTx: number;
	readonly totalFees: number;
	readonly medianFee: number;
	readonly feeRange: readonly number[];
	readonly weight: number;
}

export interface StatsUpdate {
	readonly mempoolTxCount?: number;
	readonly fees?: {
		readonly fastest: number;
		readonly halfHour: number;
		readonly hour: number;
		readonly economy: number;
	};
}

export type SourceStatus = 'idle' | 'connecting' | 'live' | 'degraded' | 'disconnected';

/** Every announcement a chain data source can make. Name → payload. */
export interface ChainEvents {
	'wallet:created': { name: string; address: Address };
	'tx:added': TxInfo;
	'tx:rejected': { reason: string; fromName: string; toName: string; amount: number };
	'mining:started': {
		index: number;
		minerName: string;
		txCount: number;
		/** everyone racing for this block (winner listed first) */
		competitors: readonly string[];
	};
	'mining:progress': { index: number; nonce: number; hashAttempt: Hex };
	'block:mined': BlockInfo;
	'chain:tampered': { blockIndex: number };
	'chain:validated': ValidationReport;

	// ── live-only, additive ──
	'mempool:projection': { blocks: readonly ProjectedBlock[] };
	'stats:updated': StatsUpdate;
	'chain:reorg': { orphanedHashes: readonly Hex[]; newTipHeight: number };
	'source:status': { kind: 'simulated' | 'live'; status: SourceStatus; retryInSec?: number };
}
