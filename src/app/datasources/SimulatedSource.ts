import type { DataSource } from '../../core/datasources/DataSource';
import type { TypedEventEmitter } from '../../core/events';
import type { ChainEvents, SourceStatus } from '../../core/events/chainEvents';

/** any model that owns the event stream (ChainModel, PosChainModel, …) */
interface EventfulModel {
	readonly events: TypedEventEmitter<ChainEvents>;
}

/** any simulation with the playback trio (BaseSimulation subclasses) */
interface PlayableSimulation {
	start(): void;
	resume(): void;
	pause(): void;
}

/**
 * The engine-driven flow behind the DataSource seam — a pure wrapper,
 * deliberately boring: events are the Model's own emitter (consumers
 * keep the exact stream they always had), start/stop delegate to the
 * Simulation. Lives in the app layer because it composes app classes;
 * the contract it implements lives in core.
 */
export class SimulatedSource implements DataSource {
	readonly kind = 'simulated' as const;
	private _status: SourceStatus = 'idle';
	private started = false;

	constructor(
		private readonly model: EventfulModel,
		private readonly simulation: PlayableSimulation,
	) {}

	get status(): SourceStatus {
		return this._status;
	}

	get events(): TypedEventEmitter<ChainEvents> {
		return this.model.events;
	}

	/** Idempotent: the first call boots the simulation, later calls resume it. */
	async start(): Promise<void> {
		if (!this.started) {
			this.started = true;
			this.simulation.start();
		} else {
			this.simulation.resume();
		}
		this._status = 'live';
		this.events.emit('source:status', { kind: this.kind, status: this._status });
	}

	stop(): void {
		this.simulation.pause();
		this._status = 'idle';
		this.events.emit('source:status', { kind: this.kind, status: this._status });
	}
}
