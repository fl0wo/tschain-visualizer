import { TypedEventEmitter } from '../../events';
import type { ChainEvents, SourceStatus } from '../../events/chainEvents';
import type { Hex } from '../../types';
import type { DataSource } from '../DataSource';
import { blockInfoFromDto, projectionFromDtos, statsFrom } from './mapping';
import { MempoolRestClient } from './restClient';
import { wsMessageSchema, type FeesDto, type MempoolBlockDto, type MempoolInfoDto } from './schemas';

/** The subset of the WebSocket API we use — injectable for tests. */
export interface WebSocketLike {
	send(data: string): void;
	close(): void;
	onopen: (() => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: (() => void) | null;
	onerror: (() => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface MempoolSourceOptions {
	wsFactory?: WebSocketFactory;
	rest?: MempoolRestClient;
	/** how many recent blocks to backfill on start (REST returns ~10) */
	backfillCount?: number;
	/** silence longer than this ⇒ stale connection, force reconnect */
	stalenessMs?: number;
	baseBackoffMs?: number;
	backoffCapMs?: number;
	wsUrl?: string;
}

/**
 * # MempoolSpaceSource — live Bitcoin behind the DataSource seam
 *
 * One WebSocket (wss://mempool.space/api/v1/ws, `want: blocks,
 * mempool-blocks, stats`) plus a small cached REST client for backfill
 * and resync. Everything is translated into the ChainEvents vocabulary
 * in mapping.ts — consumers cannot tell this source from the simulator.
 *
 * Resilience model:
 *  - reconnect with exponential backoff + jitter (1s → 30s cap), status
 *    `degraded` while retrying, `disconnected` after repeated failures
 *    (retries continue either way);
 *  - staleness watchdog: the stats/projection families tick steadily,
 *    so prolonged silence means a dead socket — close and reconnect;
 *  - every (re)connection re-sends the subscription and re-syncs via
 *    REST, diffing against the local tip and emitting anything missed
 *    in order;
 *  - a block whose parent isn't our tip triggers the same resync, and
 *    if the remote chain disagrees with hashes we already emitted, a
 *    `chain:reorg` event lists the orphaned hashes first — rare, and
 *    one of the best educational moments live data can give us.
 */
export class MempoolSpaceSource implements DataSource {
	readonly kind = 'live' as const;
	readonly events = new TypedEventEmitter<ChainEvents>();

	private _status: SourceStatus = 'idle';
	private ws: WebSocketLike | null = null;
	private stopped = false;
	private started = false;

	private tipHeight = -1;
	/** height → hash for the blocks we've emitted (reorg diffing) */
	private readonly emitted = new Map<number, Hex>();

	private attempt = 0;
	private lastMessageAt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private stalenessTimer: ReturnType<typeof setInterval> | null = null;

	private lastMempoolInfo: MempoolInfoDto | undefined;
	private lastFees: FeesDto | undefined;

	private readonly wsFactory: WebSocketFactory;
	private readonly rest: MempoolRestClient;
	private readonly backfillCount: number;
	private readonly stalenessMs: number;
	private readonly baseBackoffMs: number;
	private readonly backoffCapMs: number;
	private readonly wsUrl: string;

	constructor(options: MempoolSourceOptions = {}) {
		this.wsFactory = options.wsFactory ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
		this.rest = options.rest ?? new MempoolRestClient();
		this.backfillCount = options.backfillCount ?? 10;
		this.stalenessMs = options.stalenessMs ?? 90_000;
		this.baseBackoffMs = options.baseBackoffMs ?? 1_000;
		this.backoffCapMs = options.backoffCapMs ?? 30_000;
		this.wsUrl = options.wsUrl ?? 'wss://mempool.space/api/v1/ws';
	}

	get status(): SourceStatus {
		return this._status;
	}

	/** Backfill history via REST first, then open the stream. Idempotent. */
	async start(): Promise<void> {
		if (this.started && this.ws) return;
		this.started = true;
		this.stopped = false;
		this.setStatus('connecting');

		try {
			const recent = await this.rest.recentBlocks();
			const ascending = [...recent].sort((a, b) => a.height - b.height).slice(-this.backfillCount);
			for (const dto of ascending) this.acceptBlock(dto, true);
		} catch {
			// REST backfill failing is degraded, not fatal — the stream may
			// still come up and resync will fill gaps.
			this.setStatus('degraded');
		}

		this.connect();
	}

	stop(): void {
		this.stopped = true;
		this.started = false;
		this.clearTimers();
		this.ws?.close();
		this.ws = null;
		this.setStatus('idle');
	}

	// ── socket lifecycle ───────────────────────────────────────────────

	private connect(): void {
		if (this.stopped) return;
		const ws = this.wsFactory(this.wsUrl);
		this.ws = ws;

		ws.onopen = () => {
			ws.send(JSON.stringify({ action: 'want', data: ['blocks', 'mempool-blocks', 'stats'] }));
			this.attempt = 0;
			this.lastMessageAt = Date.now();
			this.setStatus('live');
			this.startStalenessWatchdog();
			// catch anything that confirmed while we were away
			if (this.tipHeight >= 0) void this.resync();
		};
		ws.onmessage = (event) => {
			this.lastMessageAt = Date.now();
			this.handleFrame(event.data);
		};
		ws.onclose = () => {
			if (this.stopped) return;
			this.scheduleReconnect();
		};
		ws.onerror = () => {
			// some implementations error without closing — force the close
			// path so reconnection logic lives in exactly one place
			ws.close();
		};
	}

	private scheduleReconnect(): void {
		if (this.stopped || this.reconnectTimer !== null) return;
		this.clearTimers();
		this.ws = null;
		this.attempt++;
		const exponential = Math.min(this.backoffCapMs, this.baseBackoffMs * 2 ** (this.attempt - 1));
		const delay = exponential * (0.7 + Math.random() * 0.6); // ±30% jitter
		this.setStatus(this.attempt > 5 ? 'disconnected' : 'degraded', Math.round(delay / 1000));
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, delay);
	}

	private startStalenessWatchdog(): void {
		if (this.stalenessTimer !== null) clearInterval(this.stalenessTimer);
		this.stalenessTimer = setInterval(() => {
			if (Date.now() - this.lastMessageAt > this.stalenessMs) {
				// the stream ticks steadily; silence this long is a dead socket
				this.setStatus('degraded');
				this.ws?.close();
			}
		}, Math.max(1_000, this.stalenessMs / 3));
	}

	private clearTimers(): void {
		if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
		if (this.stalenessTimer !== null) clearInterval(this.stalenessTimer);
		this.reconnectTimer = null;
		this.stalenessTimer = null;
	}

	// ── message handling ───────────────────────────────────────────────

	private handleFrame(data: unknown): void {
		let raw: unknown;
		try {
			raw = JSON.parse(typeof data === 'string' ? data : String(data));
		} catch {
			return; // not JSON — ignore the frame
		}
		const parsed = wsMessageSchema.safeParse(raw);
		if (!parsed.success) return; // a family we consume was malformed

		const msg = parsed.data;
		if (msg.block) this.handleIncomingBlock(msg.block);
		for (const dto of msg.blocks ?? []) this.handleIncomingBlock(dto);
		if (msg['mempool-blocks']) {
			this.events.emit('mempool:projection', { blocks: projectionFromDtos(msg['mempool-blocks']) });
		}
		if (msg.mempoolInfo || msg.fees) {
			this.lastMempoolInfo = msg.mempoolInfo ?? this.lastMempoolInfo;
			this.lastFees = msg.fees ?? this.lastFees;
			this.events.emit('stats:updated', statsFrom(this.lastMempoolInfo, this.lastFees));
		}
	}

	private handleIncomingBlock(dto: MempoolBlockDto): void {
		if (dto.height <= this.tipHeight) return; // duplicate or stale
		const extendsTip =
			this.tipHeight < 0 || dto.previousblockhash === this.emitted.get(this.tipHeight);
		if (extendsTip && dto.height === this.tipHeight + 1) {
			this.acceptBlock(dto, false);
			return;
		}
		// gap or parent mismatch: let REST tell us the true chain
		void this.resync();
	}

	private acceptBlock(dto: MempoolBlockDto, backfill: boolean): void {
		this.events.emit('block:mined', blockInfoFromDto(dto, backfill));
		this.tipHeight = dto.height;
		this.emitted.set(dto.height, dto.id);
		// bounded memory: we only need recent history for reorg diffing
		this.emitted.delete(dto.height - 60);
	}

	/**
	 * Reconcile with the chain REST reports: emit anything we missed in
	 * order; if the remote chain DISAGREES with a hash we already
	 * emitted, announce the orphaned hashes as a chain:reorg first.
	 */
	private async resync(): Promise<void> {
		let remote: MempoolBlockDto[];
		try {
			remote = (await this.rest.recentBlocks()).sort((a, b) => a.height - b.height);
		} catch {
			this.setStatus('degraded');
			return;
		}
		if (remote.length === 0) return;

		const orphaned: Hex[] = [];
		for (const dto of remote) {
			const local = this.emitted.get(dto.height);
			if (local !== undefined && local !== dto.id) orphaned.push(local);
		}
		if (orphaned.length > 0) {
			const newTipHeight = remote[remote.length - 1]!.height;
			this.events.emit('chain:reorg', { orphanedHashes: orphaned, newTipHeight });
			// rewind past the orphaned region so the replacement re-emits
			const firstOrphanHeight = Math.min(
				...remote.filter((d) => orphaned.includes(this.emitted.get(d.height) ?? '')).map((d) => d.height),
			);
			for (const [height] of this.emitted) {
				if (height >= firstOrphanHeight) this.emitted.delete(height);
			}
			this.tipHeight = firstOrphanHeight - 1;
		}

		for (const dto of remote) {
			if (dto.height > this.tipHeight) this.acceptBlock(dto, false);
		}
	}

	private setStatus(status: SourceStatus, retryInSec?: number): void {
		this._status = status;
		this.events.emit('source:status', { kind: this.kind, status, retryInSec });
	}
}
