# Design — DataSource abstraction + live Bitcoin via mempool.space

Status: proposed, awaiting review. Target route: `/live/bitcoin` (per
request; the prompt's `/simulate/bitcoin` + Live/Simulated toggle assumes
prompt 3's network registry, which is still at its own design gate — this
milestone is independent of it and lands on today's code. When the registry
ships, `NetworkConfig.dataSources` and the toggle slot in unchanged.)

## 1. The `DataSource` interface

```ts
// core/datasources/DataSource.ts
export type SourceStatus = 'idle' | 'connecting' | 'live' | 'degraded' | 'disconnected';

export interface DataSource {
	readonly kind: 'simulated' | 'live';
	readonly status: SourceStatus;
	/** The same typed vocabulary the simulation emits — the View cannot
	 *  tell sources apart. */
	readonly events: TypedEventEmitter<ChainEvents>;
	/** Backfill recent history first (events flagged backfill: true),
	 *  then stream. Idempotent; safe to call again after disconnect. */
	start(): Promise<void>;
	stop(): void;
}
```

Deviation from the prompt sketch: instead of `on(event, handler)` on the
source, we expose the existing `TypedEventEmitter` as `events` — it is the
idiom every consumer already uses (`model.events.on(...)`), and its `on`
already returns the `Unsubscribe` disposer the sketch asks for. One event
idiom in the codebase, not two.

### Event vocabulary: frozen + additive

`ChainEvents`, `TxInfo`, `BlockInfo` move from `app/model/ChainModel.ts` to
`core/events/chainEvents.ts` (core code may not import app code). Frozen
events stay byte-identical. Additive changes:

- `BlockInfo` gains OPTIONAL fields: `txCount?` (live blocks carry counts,
  not 4 000 TxInfos), `minerName?`, `rewardTotal?`, `fees?`, `medianFee?`,
  `difficulty?`, `weight?`, `backfill?`, `source?: 'simulated' | 'live'`.
  Simulated blocks keep populating `transactions` exactly as today.
- New events (the prompt explicitly allows additive vocabulary):
  - `mempool:projection` — `{ blocks: ProjectedBlock[] }` where
    `ProjectedBlock = { nTx, totalFees, medianFee, feeRange, weight }`
  - `stats:updated` — `{ mempoolTxCount, fees: { fastest, halfHour, hour, economy } }`
  - `chain:reorg` — `{ orphanedHashes: Hex[], newTipHeight: number }`
  - `source:status` — `{ kind, status, retryInSec? }` (drives the HUD pill)

### `SimulatedSource` (pure refactor, zero behavior change)

Wraps today's `ChainModel` + `Simulation`: `start()` = `simulation.start()`,
`stop()` = `pause()`, `events` = the model's emitter. The PoW page wires
through it; every existing test stays green untouched except imports.
The Controller's only concrete dependency on `ChainModel` beyond events is
`getConfirmations`/`balances` — extracted into a tiny `ChainQuery` interface
both sources implement (live: confirmations = `tip − height + 1`).

## 2. `MempoolSpaceSource` — event-mapping table

| mempool.space payload | transport | → our event | mapping |
|---|---|---|---|
| `block` message | WS | `block:mined` | `id→hash`, `height→index`, `previousblockhash→previousHash`, `timestamp`(s→ms), `tx_count→txCount`, `extras.pool.name→minerName`, `extras.reward→rewardTotal`, `extras.totalFees→fees`, `extras.medianFee→medianFee`, `difficulty`, `weight`; `transactions: []` |
| `GET /api/v1/blocks` (on start) | REST | `block:mined` ×~10, `backfill: true`, oldest→newest | same mapping; View builds the chain instantly, no animations |
| `mempool-blocks` message | WS | `mempool:projection` | array → `ProjectedBlock[]` (queue order = next block first) |
| `mempoolInfo` / `fees` stats | WS | `stats:updated` | mempool tx count + fee tiers (fastest / ½h / 1h / economy) |
| block whose `previousblockhash` ≠ our tip | WS → REST resync | `chain:reorg`, then ordered `block:mined` | orphaned local hashes listed; new branch diffed from `/v1/blocks` |
| socket lifecycle | — | `source:status` | connecting → live → degraded (stale/reconnecting, with retry countdown) → disconnected |
| (derived locally) | — | finality badges | confirmations = `tipHeight − blockHeight + 1`; 6+ renders solid |

Not emitted in live mode: `mining:started/progress` (no nonce stream
exists; the projection queue replaces the mining ghost — and
`SceneView.finishMining` already tolerates `block:mined` without a prior
`mining:started`), `tx:added/rejected` (we don't stream individual txs;
pending state is the projection), `wallet:*`.

Units: the adapter converts sats → BTC at the boundary; DTOs never leak
past `mapping.ts`.

### Resilience (hard requirement)

- Reconnect: exponential backoff `1s·2ⁿ` ±30 % jitter, capped 30 s; status
  `degraded` while retrying, `disconnected` after the cap with a visible
  countdown.
- Staleness: `mempool-blocks`/`stats` tick steadily, so >90 s of silence ⇒
  treat as stale, force-reconnect.
- On reconnect: re-send the `want` subscription, then REST `/v1/blocks`
  diff against the local tip and emit anything missed, in order.
- Rate-limit / error spikes ⇒ `degraded`, keep rendering last-known state,
  HUD toast offers the simulated PoW page as fallback.
- WebSocket + `fetch` are injected (constructor takes factories) — that is
  what makes the adapter fully testable offline.

## 3. Sharing the MVC (one View, two sources)

The Controller/Hud/SceneView stay single-sourced; live mode is a
configuration, not a fork:

- `LiveBitcoinPresenter` composes the SAME components and only (a) selects
  live narrator copy, (b) hides simulation-only HUD (playback transport,
  miners race, wallets) and shows live HUD (status pill, fee tiers,
  mempool stats, "Live data by mempool.space" attribution link),
  (c) enables two view components that are data-driven and dormant in sim
  mode today:
  - `ProjectionRow` — the `mempool:projection` queue as translucent amber
    ghost cubes before the tip, labeled `nTx · ~medianFee sat/vB`,
    reflowing on updates; nearest ghost solidifies on `block:mined` (the
    real hash locks in with leading zeros highlighted — no fake nonce).
  - **Tx density mode** in `BlockMesh`: when a block carries `txCount`
    instead of `transactions`, render one `InstancedMesh` of micro-cubes
    (instances = `min(ceil(sqrt(nTx))², 256)`, one draw call) instead of
    per-tx `TxCubeMesh`es — and none of the per-tx signing/verification
    choreography runs (those animations are driven by `tx:added`, which
    live mode never emits). This is the answer to "don't animate every
    transaction": live txs are aggregate geometry, not actors.
- Because both modes share the components, a UI change to blocks, links,
  tooltips, ticker or narrator automatically applies to both.
- Block tooltips link out to `https://mempool.space/block/<hash>`; hashes,
  heights and pool names in Geist Mono with the existing click-to-copy.

## 4. File tree

```
src/core/events/chainEvents.ts      ChainEvents + TxInfo + BlockInfo (moved; additive fields)
src/core/datasources/
  DataSource.ts                     interface + SourceStatus
  SimulatedSource.ts                wraps ChainModel + Simulation (pure refactor)
  mempool/
    MempoolSpaceSource.ts           WS lifecycle, backoff, staleness, resync, reorg
    restClient.ts                   one method per endpoint, zod-validated, cached by hash
    schemas.ts                      zod schemas for the four payload families
    mapping.ts                      DTO → domain events; sats→BTC; nothing leaks past here
src/app/live/
  liveBitcoinApp.ts                 composition root for /live/bitcoin
  LiveBitcoinPresenter.ts           configures shared Controller/Hud/SceneView
src/app/view/ProjectionRow.ts       amber ghost queue (data-driven, dormant in sim)
src/app/view/BlockMesh.ts           + density mode (InstancedMesh, capped)
src/main.ts                         + /live/bitcoin route; home Bitcoin card goes live
tests/datasources/
  fixtures/*.json                   recorded real payloads (block, mempool-blocks, stats, /v1/blocks)
  MempoolSpaceSource.test.ts        mock WS: mapping, backoff+resubscribe+resync, reorg
  restClient.test.ts                schema validation + cache behavior
  live.integration.test.ts          30 s against the real endpoint, skipped unless LIVE=1
```

New dependency: `zod` (mandated for wire validation; ~13 kB gzipped, dev
+ runtime). Everything else stays zero-framework.

## 5. Commit plan & test plan

1. **Refactor to DataSource** — vocabulary move + SimulatedSource +
   ChainQuery; `/simulate/pow` identical; all 45 tests green (imports only).
2. **Adapter** — schemas, REST client, WS source; fixture-driven unit
   tests: payload mapping, backoff + resubscribe + REST resync after a
   dropped mock socket, reorg detection on parent-hash mismatch, cache
   never refetches a block hash; opt-in 30 s live integration test.
3. **View layer** — ProjectionRow, density mode, live HUD/presenter,
   route, README (data-flow diagram, attribution, "adding a live adapter"
   recipe).

Scope discipline honored: no EVM/Solana scaffolding, no consensus-engine
changes, one WS connection, REST cached by block hash, no keys/backend.
