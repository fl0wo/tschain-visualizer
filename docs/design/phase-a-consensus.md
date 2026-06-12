# Phase A design — consensus as a strategy

Status: proposed, awaiting review. Scope: core refactor + PoW/PoS/PoA/PoH
engines + minimal app wiring so `/simulate/pow` behaves exactly as today and
`/simulate/pos|poa|poh` run end-to-end with the existing generic visuals
(per-engine visual languages are Phase D).

## 1. The `ConsensusEngine` interface

```ts
// core/consensus/ConsensusEngine.ts
import type { Block } from '../Block';
import type { Transaction } from '../Transaction';
import type { Address, Hex } from '../types';

/** Read-only view of the chain an engine may consult. Implemented by Blockchain. */
export interface ChainContext {
	readonly blocks: readonly Block[];
	getBalance(address: Address): number;
	getNonce(address: Address): number;
}

/** What proposeBlock needs beyond the txs. */
export interface ProposeRequest {
	readonly txs: readonly Transaction[];
	/** PoW: coinbase recipient. Slot-based engines pick their own proposer
	 *  from their validator/authority set and ignore this. */
	readonly beneficiary?: Address;
}

/** Demo pacing (0 = honest flat-out) + cancellation + animatable progress. */
export interface ProposeOptions {
	readonly signal?: AbortSignal;
	/** ms slept between internal work units (nonce attempts, ticks, attestation arrivals) */
	readonly paceMs?: number;
	/** minimum wall-clock duration of the whole proposal */
	readonly minMs?: number;
	readonly onProgress?: (event: EngineProgress) => void;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export type FinalityStatus =
	| { state: 'pending' }                              // not yet safe by any measure
	| { state: 'probabilistic'; confirmations: number } // PoW: depth = security
	| { state: 'finalized' };                           // PoS checkpoints, PoA majority

/** Typed engine internals the View can animate. */
export type EngineProgress =
	| { kind: 'pow:attempt'; nonce: number; hashAttempt: Hex }
	| { kind: 'pos:proposer'; slot: number; epoch: number; seed: Hex; proposer: Address }
	| { kind: 'pos:attestation'; slot: number; validator: Address; collectedStake: number; neededStake: number }
	| { kind: 'pos:finalized'; checkpointEpoch: number; finalizedThrough: number }
	| { kind: 'poa:turn'; slot: number; authority: Address }
	| { kind: 'poh:tick'; tickCount: number; pohHash: Hex; stampedTx?: Hex };

export interface ConsensusEngine {
	readonly kind: 'pow' | 'pos' | 'poa' | 'poh';
	proposeBlock(ctx: ChainContext, request: ProposeRequest, options?: ProposeOptions): Promise<Block>;
	validateBlock(ctx: ChainContext, block: Block): ValidationResult;
	finality(ctx: ChainContext, blockIndex: number): FinalityStatus;
}
```

Deviations from the prompt sketch, with reasons:

- **`headerExtension: string` dropped.** The engine's `kind` plus the
  discriminated `headerExt.kind` union already identify the extension type
  statically; a parallel string discriminator would be a second source of
  truth to keep in sync.
- **`AbortSignal` moved into `ProposeOptions`** alongside pacing and
  progress — they are all aspects of "how this proposal runs", and the
  existing `MiningPace` (yieldEvery/yieldMs/minMs) generalizes into it.
- **`ProposeRequest.beneficiary`** added: PoW needs a coinbase recipient
  from outside; slot engines self-select. One optional field keeps the
  signature uniform.

## 2. The `headerExt` union

```ts
// core/consensus/headerExt.ts
export interface GenesisExt { kind: 'genesis'; }

export interface PowExt { kind: 'pow'; nonce: number; difficulty: number; }

export interface PosAttestation {
	validator: Address; blockHash: Hex; signature: Hex; stake: number;
}
export interface PosExt {
	kind: 'pos'; slot: number; epoch: number; proposer: Address; seed: Hex;
	/** signed over the block hash AFTER it exists — excluded from the hash */
	attestations: PosAttestation[];
}

export interface PoaExt {
	kind: 'poa'; slot: number; authority: Address;
	/** signature over the block hash — excluded from the hash */
	authoritySignature: Hex;
}

export interface PohEntry { pohHash: Hex; txHash?: Hex; } // one clock tick, optionally stamping a tx
export interface PohExt {
	kind: 'poh'; slot: number; leader: Address;
	tickCount: number; entries: PohEntry[]; pohHash: Hex;
}

export type BlockHeaderExt = GenesisExt | PowExt | PosExt | PoaExt | PohExt;
```

**The hashing rule (the one real subtlety).** A block hash cannot include
data that is computed *over* that hash: PoS attestations and the PoA
authority signature sign the finished hash, so including them would be
circular — the same reason `Transaction.serialize()` excludes the tx
signature. `Block.calculateHash()` therefore serializes the extension
through a `hashableExt()` helper that strips `attestations` and
`authoritySignature`; `validateBlock` verifies those directly against the
stored hash instead. Everything else in the extension (nonce, slot,
proposer, PoH entries…) IS hashed and therefore tamper-evident.

## 3. File tree

```
src/core/
  consensus/
    ConsensusEngine.ts    interface + ChainContext + EngineProgress (above)
    headerExt.ts          BlockHeaderExt union + hashableExt()
    seededRandom.ts       tiny deterministic PRNG from a hex seed (pos + poh share it)
    ProofOfWork.ts        today's mine loop, moved verbatim; coinbase creation moves here
    ProofOfStake.ts       ValidatorSet, seeded stake-weighted selection, attestations,
                          Casper-FFG-lite checkpoints, slashing, forkChoice() helper
    ProofOfAuthority.ts   fixed authority list, round-robin slots, header signatures
    ProofOfHistory.ts     sha256 tick clock, tx stamping, leader schedule (reuses selection)
  Block.ts                index, timestamp, transactions, previousHash, headerExt, hash
                          (mine() leaves; calculateHash uses hashableExt)
  Blockchain.ts           constructor(engine, { genesisAllocations? }); addBlock = structural
                          checks + engine.validateBlock; isChainValid + engine checks;
                          finality(i) delegates to the engine
  Mempool.ts              produceBlock(beneficiary, options): batches txs, ENGINE builds the
                          block including its reward txs, appends, prunes mined batch
  Transaction.ts          + optional kind: 'transfer' | 'stake' (PoS deposits; in the hash)
  Wallet.ts / types.ts / events.ts   unchanged
src/app/
  model/ChainModel.ts     constructed with an engine; new 'engine:progress' event; optional
                          faucet mode (genesis premine + auto-grant to new wallets) for
                          non-PoW pages where nobody earns coinbases
  controller/, view/      Phase A: engine-aware narrator copy only; visuals reused
src/main.ts               /simulate/pow|pos|poa|poh → mountSimApp(engine factory)
```

## 4. Key decisions (the things worth vetoing)

1. **Rewards are the engine's job.** The coinbase moves out of Mempool into
   `ProofOfWork.proposeBlock` (same `MINING_REWARD + fees` math). PoS pays
   small proposer + attester rewards; PoA pays the authority the fees; PoH
   pays the leader fees + a small stipend. Mempool becomes engine-agnostic.
2. **PoW hash values change, behavior doesn't.** The hash payload now
   serializes `headerExt` instead of a bare nonce field, so concrete hashes
   differ from today. No test or feature depends on specific hash values —
   determinism/sensitivity contracts are unchanged, `/simulate/pow` looks
   and acts identically.
3. **`Blockchain.difficulty` moves into the PoW engine's config.** The model
   exposes engine metadata for HUD copy instead.
4. **Stake = a real transaction.** `kind: 'stake'` transfers the deposit to
   a `STAKE_VAULT` sentinel address, so locked stake naturally leaves the
   spendable balance via the existing `getBalance` replay — no parallel
   bookkeeping. Exits return stake via a protocol (from-null) tx.
5. **Slots advance per produced block.** A "slot" is consumed each time the
   simulation produces a block — no background wall-clock until Phase D
   needs one. Epoch length is config (small by default so finality is
   visible within a demo session).
6. **Seeded determinism.** Proposer/leader selection uses
   `seed = sha256(epoch | slot | previousHash)` through a tiny explicit PRNG
   — deterministic, testable, and the seed is showable in the HUD (the
   "randao-like mix", honestly labeled as simplified).
7. **/simulate/pos bootstrap.** Protocol validators ("Validator 1–4") are
   seeded in the engine config with stake; user wallets are funded by a
   genesis-premined faucet wallet whose grants flow through the normal
   mempool as visible transactions (testnet-faucet style). The PoW page
   keeps its mining-funded economy and changes in no observable way.
8. **Event compatibility.** The model keeps `mining:started/progress/
   block:mined` as the generic produce-a-block lifecycle (renaming would
   churn the whole view for no Phase A benefit) and adds `engine:progress`
   carrying the typed union above. Phase D may rename when the per-engine
   views land.

## 5. Test plan

- **Adapted (45 existing):** Block tests construct via PoW ext;
  `Block.mine` → `ProofOfWork.proposeBlock`; Mempool/Blockchain tests get a
  PoW engine; pacing tests port unchanged.
- **ProofOfWork:** target met; tamper invalidates; paced mining timing.
- **ProofOfStake:** stake-weighted selection deterministic for a fixed
  seed; block without ≥2/3 committee stake rejected; `simulateEquivocation`
  slashes and ejects; two consecutive supermajority checkpoints finalize
  the first; `forkChoice` never selects a head that reverts a finalized
  checkpoint.
- **ProofOfAuthority:** out-of-turn authority rejected; non-authority
  rejected; bad header signature rejected; rotation order holds.
- **ProofOfHistory:** tick counts strictly increase across blocks; swapping
  two stamped txs breaks sequence verification; stamp order is provable.
- **Cross-engine:** a block valid under PoW fails `validateBlock` under PoA
  (engines actually gate validity).
- **App smoke:** ChainModel with each engine produces a valid 3-block chain
  headlessly.
