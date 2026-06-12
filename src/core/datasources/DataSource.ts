import type { TypedEventEmitter } from '../events';
import type { ChainEvents, SourceStatus } from '../events/chainEvents';

/**
 * # DataSource — where chain activity comes from
 *
 * The View renders events; it must never know whether those events were
 * produced by the local simulation engine or streamed from a real
 * network. A DataSource is anything that can speak the ChainEvents
 * vocabulary:
 *
 *  - SimulatedSource wraps the engine-driven flow (app layer, since it
 *    composes the app's Model + Simulation),
 *  - MempoolSpaceSource adapts live Bitcoin from mempool.space,
 *  - future adapters (EVM, Solana) implement the same three members.
 *
 * `start()` must emit a backfill of recent history first (block:mined
 * events flagged `backfill: true`, oldest → newest) so a page can build
 * its chain instantly, then stream new events. It is idempotent and
 * safe to call again after `stop()`.
 */
export interface DataSource {
	readonly kind: 'simulated' | 'live';
	readonly status: SourceStatus;
	/** The same typed vocabulary the simulation emits — consumers cannot
	 *  tell sources apart. `events.on()` returns the unsubscribe fn. */
	readonly events: TypedEventEmitter<ChainEvents>;
	start(): Promise<void>;
	stop(): void;
}
