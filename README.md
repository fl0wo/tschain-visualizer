# tschain-visualizer

[Live Demo](https://tschain.floriansabani.com/simulate/pow)

A 3D visualizer for learning how blockchains actually work — watch
consensus happen, simulated or **live**. TypeScript + three.js, no
framework, no backend.

<img src="docs/gifpow.gif" alt="proof-of-work simulation in the visualizer" width="1280" height="710" />

## Routes

| Route | What you watch |
|---|---|
| `/` | the catalog (keyboard-navigable) |
| `/simulate/pow` | an ambient simulated economy: Ed25519-signed payments, a paced-but-real SHA-256 mining race with fees and rewards, double-spend rejections, tamper-evident chain links — narrated step by step, with debugger-style playback (pause / step / speed) |
| `/simulate/pos` | the same economy under **proof of stake**: staking validators, a seeded stake-weighted proposer per slot (verifiable from the published seed), ≥⅔ attestations sealing blocks on a clock, small proposer/attester rewards, faucet-funded users |
| `/simulate/lightning` | **Layer 2, the bar-tab model**: a channel graph on a ticking Bitcoin parent — dual-signed off-chain payments, multi-hop HTLCs with routing fees, and the cheat game (broadcast an old state; the watchtower punishes it — or doesn't) |
| `/simulate/base` | **Layer 2, the batch + courtroom model**: an optimistic rollup on a ticking Ethereum parent — instant soft txs compressing into L1 bricks, challenge-window countdowns, provable fraud with visible rollback, and the asymmetric bridge |
| `/live/bitcoin` | the same scene fed by [mempool.space](https://mempool.space): ~10 last real blocks backfilled, amber ghost cubes for the projected next blocks, live transactions popping in with their BTC amounts, pool win-odds, fee tiers, reorg handling |

## Quick start

```bash
pnpm install
npm run dev     # visualizer at http://localhost:5173
npm test        # 57 unit tests (core, model, live adapter — all offline)
npm run demo    # narrated console walkthrough of the core chain
```

## How it works

```
core/        pure domain logic, zero DOM/three imports
  Transaction · Wallet · Block · Blockchain · Mempool   (the educational chain)
  events/chainEvents.ts     the ONE event vocabulary both sources speak
  datasources/              DataSource seam + mempool.space adapter
                            (zod-validated wire → domain mapping, reconnect/resync/reorg)
app/
  model/ChainModel          wraps the core, emits typed events
  view/                     three.js scene + HUD (edge-lit cubes, callouts, narrator)
  controller/, live/        per-page wiring: simulation Controller / live Presenter
```

The View only ever consumes events — it cannot tell the simulator from
the live adapter, so every UI improvement applies to both pages. Adding
a live adapter for another chain = implement `DataSource`, map wire
payloads into `ChainEvents` at the boundary, register a route.

## Layer 2 — the two mental models

- **Lightning (state channels) = the bar tab + the courtroom.** Lock
  funds on Bitcoin once, then pay each other privately — every update
  dual-signed, numbered, and invisible to the chain. The chain is only
  the courtroom: open, close, or dispute. Try the **cheat button**:
  broadcasting an old state loses everything while the watchtower is
  on… and quietly works when it's off.
- **Base (optimistic rollup) = the batch + the challenge window.** A
  sequencer orders transactions instantly (soft), then compresses many
  of them into one L1 transaction carrying the data and a claimed state
  root. The L1 believes it *optimistically* — unless someone re-executes
  the posted data inside the window and proves fraud. Try **post fraud**
  with the verifier on (bolt, rollback, slashed bond) and off (an
  invalid state becomes final — the trust assumption, demonstrated).

## Honest by design

Education over spectacle, but never fake: signatures are real Ed25519,
the simulated proof-of-work is a real (low-difficulty, deliberately
paced — your battery is safe) SHA-256 search, live data is real mainnet.
Where reality can't be shown, the UI says so — e.g. nobody can list who
is "currently mining", so the live pools panel shows each pool's recent
block share, which *is* its odds of winning the next block.

## Credits

Live Bitcoin data by [mempool.space](https://mempool.space). Fonts:
[Geist](https://vercel.com/font) via Google Fonts.

## License

[MIT](LICENSE)
