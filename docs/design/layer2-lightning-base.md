# Design — Layer 2 pages: /simulate/lightning & /simulate/base

Status: proposed, awaiting review. Deliverable: two working pages.
Simulated only; the mempool.space adapter is untouched.

## 0. Reality mapping (what the spec assumes vs what exists)

The spec references prompt-3 artifacts that are still at their own design
gate: `ConsensusEngine`, the network registry, the boot-all-networks
smoke test. Per the spec's own clause ("if not, this spec supersedes
it"), this design builds on what is real today:

- **Parent L1s are the existing simulations**: a `ChainModel` + PoW
  `Simulation` instance under Lightning (bitcoin-style), a
  `PosChainModel` + `PosSimulation` instance under Base
  (ethereum-style). They run their ambient traffic in the background,
  driven by the existing tick system — one clock family for both layers.
- **Registry** → a typed `src/app/l2/config.ts` params module (diff in
  §4); it moves verbatim into `NetworkConfig.params` when prompt 3
  lands. The "no changes outside registry + new modules" assertion
  becomes: routes/main.ts gain two mount lines (same as every existing
  page), everything else is new modules.
- **Boot smoke test** → added per L2: boot parent + L2 headlessly, run
  N ticks, assert invariants (chain valid, funds conserved, no leaked
  timers).
- **Teardown**: the router's deliberate full-reload-on-back already
  guarantees clean teardown for pages; `stop()` is still implemented on
  every L2 module (and used by the headless tests).

## 1. `Layer2System` (core/layers/Layer2System.ts)

```ts
/** What an L2 needs from its parent — a facade over the running L1
 *  model, NOT the model itself (core L2 code must not know app types). */
export interface ParentL1 {
	readonly events: TypedEventEmitter<ChainEvents>;
	/** inject a settlement transaction into the L1 mempool; returns its
	 *  hash — confirmations are the L2's only clock for windows */
	submitSettlement(request: SettlementRequest): Hex;
	getConfirmations(txHash: Hex): number;
	getBalance(address: Address): number;
}

export interface SettlementRequest {
	/** labels the special tx for the view/ticker */
	readonly kind: 'channel-open' | 'channel-close' | 'justice' | 'batch' | 'deposit' | 'withdrawal';
	readonly from: Wallet | null; // null = protocol-style settlement
	readonly to: Address;
	readonly amount: number;
	/** opaque payload (state numbers, roots, compressed batch data) */
	readonly memo?: string;
}

export interface Layer2System<E> {
	readonly kind: 'state-channel' | 'optimistic-rollup';
	readonly events: TypedEventEmitter<E>;
	/** subscribe to parent blocks and begin the L2's own activity */
	start(): void;
	stop(): void;
}
```

Deviations from the sketch, with reasons:
- `parent: { chain; engine }` → the `ParentL1` facade: no engine type
  exists, and L2 core must not import app models. The app layer adapts
  `ChainModel`/`PosChainModel` to `ParentL1` in ~20 lines each.
- `on(e, h)` → `events` emitter field (the codebase-wide idiom; its
  `on` already returns the unsubscribe).
- `start(signal)` → `start()/stop()` like `DataSource`; an optional
  `AbortSignal` adds a second cancellation idiom for no gain here.

**One small core addition (approval needed):** `Transaction` gains an
optional `kind?: string` (default `'transfer'`, serialized INSIDE the
hash like every other field). It is how settlement txs are visibly
"special" in tooltips, blocks and the ticker without parallel
bookkeeping. Additive: nothing existing changes behavior.

## 2. Event vocabularies (typed, additive, own emitters)

### `ChannelEvents` (lightning)

```ts
'channel:funding-pending' { channelId; a; b; fundingTxHash }       // L1 wait begins
'channel:opened'          { channelId; a; b; balanceA; balanceB }  // funding confirmed
'channel:updated'         { channelId; stateNumber; balanceA; balanceB }  // OFF-chain
'payment:routed'          { paymentId; path: string[]; amount; feePerHop }
'payment:hop'             { paymentId; hop; phase: 'lock' | 'reveal' }    // staggered HTLC anim
'payment:failed'          { paymentId; reason; atHop }
'channel:close-pending'   { channelId; settlementTxHash }
'channel:closed'          { channelId; finalA; finalB }
'channel:disputed'        { channelId; cheater; broadcastStateNumber; latestStateNumber; windowBlocks }
'dispute:tick'            { channelId; blocksLeft }                 // per L1 block
'dispute:resolved'        { channelId; outcome: 'justice' | 'cheat-succeeded'; penaltyTo? }
```

### `RollupEvents` (base)

```ts
'l2tx:soft-confirmed'  { tx: TxInfo; l2Block: number }
'l2block:produced'     { index; txCount }
'batch:posted'         { batchId; l2Blocks: [from, to]; txCount; preStateRoot; postStateRoot; l1TxHash }
                       // NOTE: fraud is never flagged here — verifiers must DISCOVER it
'batch:confirmed'      { batchId; l1Block }
'batch:window-tick'    { batchId; blocksLeft; windowBlocks }        // per L1 block
'batch:challenged'     { batchId; verifier; reason: 'state-root-mismatch' }
'batch:reverted'       { batchId; revertedTxHashes; rolledBackToL2Block }
'batch:finalized'      { batchId; valid: boolean }                  // valid:false = unchallenged fraud
'withdrawal:requested' { id; account; amount; batchId }
'withdrawal:ready'     { id }
'withdrawal:completed' { id; l1TxHash }
'deposit:requested'    { id; account; amount; l1TxHash }
'deposit:credited'     { id }
```

Finality ladder exposed as `finality(txHash): 'soft' | 'posted' | 'finalized'`.

## 3. Mechanics (what the tests pin down)

**Lightning** (`core/layers/lightning/StateChannelNetwork.ts`)
- Channel state `{balanceA, balanceB, stateNumber, sigA, sigB}` — every
  off-chain update is REALLY signed by both parties' Wallets (Ed25519
  over the serialized state); state numbers strictly increase.
- Funding/close/justice ride `submitSettlement`; the channel is usable
  only after `getConfirmations(fundingTx) ≥ 1` (opening costs an L1 wait).
- Multi-hop: shortest path over the channel graph (6 nodes default,
  some user-controllable); simplified HTLC = lock forward / reveal
  backward, 1-unit fee per intermediary hop; atomic — a liquidity gap at
  any hop fails the WHOLE payment.
- Cheat game: `attemptCheat(channelId, oldStateNumber)` broadcasts the
  outdated state → dispute window of `disputeWindowBlocks` L1 blocks;
  watchtower ON: the newer signed state is published (justice tx) and
  the cheater's balance goes to the victim; watchtower OFF: window
  expires, cheat pays out — both outcomes shown.
- Tests: monotonic signed states (both sigs verify); off-chain updates
  never touch the L1 (block count unchanged); multi-hop conservation +
  atomic failure; cheat punished/succeeds by watchtower; cooperative
  close settles exactly the latest state.

**Base** (`core/layers/rollup/OptimisticRollup.ts`)
- Sequencer: reuses `Transaction` + Wallet verification verbatim;
  orders txs into fast L2 blocks (no consensus — a single operator
  trusted for liveness only; comments name the real-world escape hatch
  of L1 force-inclusion).
- Batch = `{ txData (serialized), preStateRoot, postStateRoot }` where
  roots = sha256 of serialized L2 state (merkle-less stand-in, named).
  Posted via `submitSettlement(kind:'batch')`.
- Verifier: re-executes batch data (it CAN — the data is on L1: data
  availability) and challenges mismatched roots inside the window →
  bad batch and everything after revert; sequencer bond slashed.
  Verifiers OFF: the fraud finalizes (`batch:finalized {valid:false}`).
- Bridge: deposit = L1 lock → credited after confirmation; withdrawal =
  L2 burn → `ready` only after its batch finalizes (the 7-day wait,
  here `challengeWindowBlocks`).
- Tests: postStateRoot re-derivable from batch data; exact rollback
  boundary (honest prefix untouched); unchallenged fraud finalizes
  (documented trust assumption); withdrawal gated by the window;
  deposit gated by L1 confirmation; soft state never survives a revert.

## 4. "Registry diff" (params module until prompt 3's registry exists)

```ts
// src/app/l2/config.ts — every tunable in one place; future
// NetworkConfig.params verbatim
export const LIGHTNING = {
	parentId: 'pow-bitcoin-style',
	l2Kind: 'state-channel',
	nodes: 6,
	channelFunding: 50,
	hopFee: 1,
	disputeWindowBlocks: 3,
	watchtowerDefault: true,
	accent: 0xf7c548, // lightning yellow (HUD accent override)
} as const;

export const BASE = {
	parentId: 'pos-ethereum-style',
	l2Kind: 'optimistic-rollup',
	l2BlockTicks: 1,
	batchSize: 8,
	batchIntervalTicks: 10,
	challengeWindowBlocks: 5,
	sequencerBond: 500,
	depositConfirmations: 1,
	accent: 0x2151f5, // Base blue
} as const;
```

Accent scope (flagged simplification): the override recolors the HUD
(CSS vars) and the NEW L2 meshes; the shared L1 scene keeps the global
palette — full per-page 3D retheming waits for the registry milestone.

## 5. Views

- **/simulate/lightning** — a new `GraphScene` (sibling of SceneView,
  built from the same primitives: theme, fat-line edge materials,
  tween engine, FaceLabel/TextSprite, callouts). Nodes as pillars on
  the iso plane; channels as thick two-color edges whose fill ratio IS
  the balance split; payment pulses + staggered HTLC lock/reveal
  glyphs. The Bitcoin L1 renders as a dimmed miniature chain strip in
  the background driven by parent `block:mined` — it lights up ONLY for
  funding/close/justice txs (the page's visual thesis). HUD: channel
  list, payment composer with route preview, open/close, watchtower
  toggle, cheat button, yellow accent, simplification notes (real LN:
  revocation keys, onion routing, CSV delays).
- **/simulate/base** — the existing SceneView renders the PoS parent
  (receded: camera frames both lanes); a new `RollupLaneView` group is
  attached above it (SceneView gains a tiny `attach(group)` API):
  small instanced L2 cubes streaming at L2 pace, compressing into a
  dense brick that drops into the L1 mempool; amber countdown ring per
  posted batch ticking per L1 block, flipping teal on finalization
  (badges upgrade); fraud shimmer + challenge bolt + visible rollback;
  bridge objects crossing lanes with the withdrawal parked at the
  boundary ("waiting out challenge window k/N"). Blue accent, real-
  params info notes.
- Both pages: instanced/pooled L2 meshes, 60fps with the parent
  running, finality badges consistent across pages.

## 6. Commit plan

1. core lightning (+ Transaction.kind, ParentL1 adapters, tests)
2. lightning view + route + HUD
3. core rollup (+ tests)
4. rollup view + route + HUD
5. polish: README "Layer 2" section (bar-tab+courtroom / batch+window
   mental models, scenario walkthroughs), headless boot tests, tuning.
