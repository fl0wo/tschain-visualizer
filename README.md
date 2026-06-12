# tschain-visualizer

[Live Demo](https://tschain.floriansabani.com/simulate/pow)

A 3D visualizer for learning how blockchains actually work — proof of
work and proof of stake simulated step by step, Layer 2s (Lightning
channels, an optimistic rollup) running on ticking L1 parents, and real
Bitcoin mainnet streamed live. TypeScript + three.js, no framework, no
backend.

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
npm test        # 82 unit tests (core, consensus, Layer 2, live adapter — all offline)
npm run demo    # narrated console walkthrough of the core chain
```

## How it works

```
core/        pure domain logic, zero DOM/three imports
  Transaction · Wallet · Block · Blockchain · Mempool   (the educational chain;
                            txs carry kind+memo — settlements are labeled and
                            data rides on-chain; wallets sign messages too)
  consensus/seededRandom    deterministic, verifiable proposer selection (PoS)
  layers/                   Layer 2: ParentL1 facade + typed L2 vocabularies
    lightning/              StateChannelNetwork — dual-signed states, HTLC
                            routing, the dispute/watchtower game
    rollup/                 OptimisticRollup — journaled state, batches whose
                            on-chain data re-executes (reExecuteBatch), fraud
                            proofs, the asymmetric bridge
  events/chainEvents.ts     the ONE event vocabulary every source speaks
  datasources/              DataSource seam + mempool.space adapter
                            (zod-validated wire → domain mapping, reconnect/resync/reorg)
app/
  model/                    ChainModel (PoW) · PosChainModel (slots, attestations,
                            faucet) — both adoptable by L2s via submitSigned
  l2/                       parent adapters + every L2 tunable (config.ts)
  view/                     the shared scene (edge-lit cubes, callouts, narrator)
                            + per-page components: ValidatorsPanel, PoolsPanel,
                            GraphScene (the Lightning graph), RollupLaneView
  controller/, live/, …     per-page wiring: simulations (one BaseSimulation
                            playback skeleton), presenters
```

The View only ever consumes events — it cannot tell the simulator from
the live adapter, so every UI improvement applies everywhere. The same
seam works vertically: a Layer 2 talks to its parent only through the
`ParentL1` facade (inject a settlement, count confirmations), so the
Lightning page runs on the PoW model and the Base page on the PoS model
without either knowing. Adding a live adapter = implement `DataSource`;
adding an L2 = implement `Layer2System` against `ParentL1`.

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
PoS proposer selection is recomputable from the seed shown in the HUD;
Lightning channel states carry two genuine signatures you could verify
yourself; rollup batches post their data on-chain and the fraud proof
is literally a re-execution of it. Where reality can't be shown, the UI
says so — e.g. nobody can list who is "currently mining", so the live
pools panel shows each pool's recent block share, which *is* its odds
of winning the next block. Each page's simplifications (revocation
keys, merkle roots, bisection games…) are named in comments and copy.

## Credits

Live Bitcoin data by [mempool.space](https://mempool.space). Fonts:
[Geist](https://vercel.com/font) via Google Fonts.

## License

[MIT](LICENSE)
