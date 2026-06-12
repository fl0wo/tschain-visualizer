/**
 * Layer-2 page parameters — every tunable in one place. When the
 * network-registry milestone lands, these move verbatim into
 * NetworkConfig.params; until then this module IS the registry diff.
 */

export const LIGHTNING = {
	parentId: 'pow-bitcoin-style',
	l2Kind: 'state-channel',
	/** lightning node count (beyond the parent's ambient population) */
	nodes: 6,
	/** default per-side channel funding */
	channelFunding: 50,
	/** what each routing intermediary earns per forwarded payment */
	hopFee: 1,
	/** dispute window, in L1 blocks (real LN: ~2016-block CSV delays) */
	disputeWindowBlocks: 3,
	watchtowerDefault: true,
	/** pause between HTLC hops so the lock/reveal choreography reads */
	hopMs: 420,
	/** HUD accent (lightning yellow) */
	accent: 0xf7c548,
} as const;

export const BASE = {
	parentId: 'pos-ethereum-style',
	l2Kind: 'optimistic-rollup',
	/** L2 blocks per simulation beat — the "fast lane" cadence */
	l2BlockTicks: 1,
	/** post a batch every N L2 txs… */
	batchSize: 8,
	/** …or every N beats, whichever first */
	batchIntervalTicks: 10,
	/** challenge window, in L1 blocks (real Base/Arbitrum: ≈7 days) */
	challengeWindowBlocks: 5,
	/** what the sequencer forfeits when a fraud is proven */
	sequencerBond: 500,
	/** L1 confirmations before a deposit credits on L2 */
	depositConfirmations: 1,
	/** HUD accent (Base blue) */
	accent: 0x2151f5,
} as const;
