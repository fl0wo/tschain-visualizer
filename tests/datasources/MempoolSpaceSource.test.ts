import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	MempoolSpaceSource,
	type WebSocketLike,
} from '../../src/core/datasources/mempool/MempoolSpaceSource';
import { MempoolRestClient } from '../../src/core/datasources/mempool/restClient';
import type { BlockInfo, ProjectedBlock } from '../../src/core/events/chainEvents';
import miningPoolsFixture from './fixtures/rest-mining-pools.json';
import restBlocksFixture from './fixtures/rest-blocks.json';
import wsBlockFixture from './fixtures/ws-block.json';
import wsMempoolBlocksFixture from './fixtures/ws-mempool-blocks.json';
import wsProjectedDeltaFixture from './fixtures/ws-projected-delta.json';
import wsStatsFixture from './fixtures/ws-stats.json';

/**
 * The adapter under test never touches the network: WebSocket and fetch
 * are injected, payloads come from recorded fixtures, time is faked.
 */

class FakeWebSocket implements WebSocketLike {
	sent: string[] = [];
	closed = false;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;

	send(data: string): void {
		this.sent.push(data);
	}
	close(): void {
		this.closed = true;
		this.onclose?.();
	}
	// test controls
	open(): void {
		this.onopen?.();
	}
	message(payload: unknown): void {
		this.onmessage?.({ data: JSON.stringify(payload) });
	}
	dropConnection(): void {
		this.onclose?.();
	}
}

/** fetch stub: /v1/blocks served from a queue (last response repeats);
 *  /v1/mining/pools served the fixture, so pool refreshes never shift
 *  the blocks queue the resync assertions depend on */
function makeRest(responses: unknown[]): MempoolRestClient {
	let call = 0;
	return new MempoolRestClient(async (url) => {
		const body = url.includes('/mining/pools')
			? miningPoolsFixture
			: responses[Math.min(call++, responses.length - 1)];
		return { ok: true, status: 200, json: async () => body };
	});
}

function makeSource(restResponses: unknown[]) {
	const sockets: FakeWebSocket[] = [];
	const source = new MempoolSpaceSource({
		wsFactory: () => {
			const ws = new FakeWebSocket();
			sockets.push(ws);
			return ws;
		},
		rest: makeRest(restResponses),
		baseBackoffMs: 1_000,
		stalenessMs: 30_000,
	});
	return { source, sockets };
}

describe('MempoolSpaceSource', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('backfills recent history oldest→newest, then goes live', async () => {
		const { source, sockets } = makeSource([restBlocksFixture]);
		const blocks: BlockInfo[] = [];
		const statuses: string[] = [];
		source.events.on('block:mined', (b) => blocks.push(b));
		source.events.on('source:status', (s) => statuses.push(s.status));

		await source.start();
		expect(blocks.map((b) => b.index)).toEqual([953350, 953351, 953352]);
		expect(blocks.every((b) => b.backfill && b.source === 'live')).toBe(true);
		// chain linkage is preserved for the View
		expect(blocks[1]!.previousHash).toBe(blocks[0]!.hash);

		expect(statuses).toEqual(['connecting']);
		sockets[0]!.open();
		expect(source.status).toBe('live');
		// the subscription was sent on open
		expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({
			action: 'want',
			data: ['blocks', 'mempool-blocks', 'stats'],
		});
	});

	it('maps a live block message into the domain vocabulary', async () => {
		const { source, sockets } = makeSource([restBlocksFixture]);
		const blocks: BlockInfo[] = [];
		source.events.on('block:mined', (b) => blocks.push(b));
		await source.start();
		sockets[0]!.open();

		sockets[0]!.message(wsBlockFixture);
		const live = blocks[blocks.length - 1]!;
		expect(live.index).toBe(953353);
		expect(live.backfill).toBe(false);
		expect(live.minerName).toBe('Foundry USA');
		expect(live.txCount).toBe(4810);
		// sats → BTC at the boundary
		expect(live.rewardTotal).toBeCloseTo(3.13940122, 8);
		expect(live.fees).toBeCloseTo(0.01440122, 8);
		expect(live.totalVolume).toBeCloseTo(1381.39871517, 6);
		expect(live.nonce).toBe(2741998213);
	});

	it('maps the mempool projection and the stats families', async () => {
		const { source, sockets } = makeSource([restBlocksFixture]);
		let projection: readonly ProjectedBlock[] = [];
		let stats: { mempoolTxCount?: number; fees?: { fastest: number } } = {};
		source.events.on('mempool:projection', (p) => (projection = p.blocks));
		source.events.on('stats:updated', (s) => (stats = s));
		await source.start();
		sockets[0]!.open();

		sockets[0]!.message(wsMempoolBlocksFixture);
		expect(projection).toHaveLength(3);
		expect(projection[0]!.nTx).toBe(4203);
		expect(projection[0]!.totalFees).toBeCloseTo(0.01322901, 8);

		sockets[0]!.message(wsStatsFixture);
		expect(stats.mempoolTxCount).toBe(10532);
		expect(stats.fees?.fastest).toBe(2);
	});

	it('streams projected-block tx DELTAS as tx:streamed (full lists stay silent)', async () => {
		const { source, sockets } = makeSource([restBlocksFixture]);
		const batches: Array<readonly { txid: string; valueBtc: number; feeRate?: number }[]> = [];
		source.events.on('tx:streamed', (p) => batches.push(p.txs));
		await source.start();
		sockets[0]!.open();

		// the subscription was requested alongside `want`
		expect(sockets[0]!.sent.some((s) => s.includes('track-mempool-block'))).toBe(true);

		// initial full list = thousands of standing txs, not news → silent
		sockets[0]!.message({
			'projected-block-transactions': {
				index: 0,
				blockTransactions: [['aa'.repeat(32), 100, 200, 5_000_000, 1.5]],
			},
		});
		expect(batches).toHaveLength(0);

		// a delta IS news: tuple [txid, fee, vsize, value(sats), rate, …]
		sockets[0]!.message(wsProjectedDeltaFixture);
		expect(batches).toHaveLength(1);
		expect(batches[0]).toHaveLength(2);
		expect(batches[0]![0]!.valueBtc).toBeCloseTo(0.0035186, 7);
		expect(batches[0]![0]!.feeRate).toBeCloseTo(3.91, 2);
		expect(batches[0]![1]!.valueBtc).toBeCloseTo(0.09391266, 8);
	});

	it('emits the pool distribution with shares ≈ next-block win odds', async () => {
		const { source, sockets } = makeSource([restBlocksFixture]);
		const updates: Array<{
			pools: readonly { name: string; share: number }[];
			sampleBlocks: number;
			networkHashrateEhs?: number;
		}> = [];
		source.events.on('miners:updated', (p) => updates.push(p));

		await source.start();
		sockets[0]!.open();
		await vi.runOnlyPendingTimersAsync();

		expect(updates).toHaveLength(1);
		const { pools, sampleBlocks, networkHashrateEhs } = updates[0]!;
		expect(sampleBlocks).toBe(131);
		expect(pools[0]!.name).toBe('Foundry USA');
		// 32 of 131 blocks last 24h → ~24% chance to win the next one
		expect(pools[0]!.share).toBeCloseTo(32 / 131, 5);
		// H/s → EH/s at the boundary
		expect(networkHashrateEhs).toBeCloseTo(907.7, 1);
	});

	it('reconnects with backoff, resubscribes, and resyncs missed blocks', async () => {
		const newTip = (wsBlockFixture as { block: object }).block;
		const { source, sockets } = makeSource([
			restBlocksFixture, // backfill
			restBlocksFixture, // resync on first open (nothing new)
			[newTip, ...(restBlocksFixture as object[])], // resync after reconnect: one missed block
		]);
		const blocks: BlockInfo[] = [];
		const statuses: string[] = [];
		source.events.on('block:mined', (b) => blocks.push(b));
		source.events.on('source:status', (s) => statuses.push(s.status));

		await source.start();
		sockets[0]!.open();
		await vi.runOnlyPendingTimersAsync(); // settle the on-open resync
		expect(blocks).toHaveLength(3);

		sockets[0]!.dropConnection();
		expect(source.status).toBe('degraded');

		// backoff: first retry ≤ 1.3s (1s base + jitter)
		await vi.advanceTimersByTimeAsync(1_400);
		expect(sockets).toHaveLength(2);
		sockets[1]!.open();
		await vi.runOnlyPendingTimersAsync();

		// resubscribed + the block missed while offline arrived in order
		expect(JSON.parse(sockets[1]!.sent[0]!)).toMatchObject({ action: 'want' });
		expect(blocks.map((b) => b.index)).toEqual([953350, 953351, 953352, 953353]);
		expect(source.status).toBe('live');
	});

	it('announces a reorg when the remote chain contradicts emitted hashes', async () => {
		const replacement352 = {
			...(restBlocksFixture as Array<Record<string, unknown>>)[0]!,
			id: '00000000000000000003ffff1111222233334444555566667777888899990000',
		};
		const child353 = {
			...(wsBlockFixture as { block: Record<string, unknown> }).block,
			previousblockhash: replacement352.id,
		};
		const { source, sockets } = makeSource([
			restBlocksFixture, // backfill: …350, 351, 352(old)
			restBlocksFixture, // resync on open
			[child353, replacement352, ...(restBlocksFixture as object[]).slice(1)], // the new truth
		]);
		const blocks: BlockInfo[] = [];
		let reorg: { orphanedHashes: readonly string[]; newTipHeight: number } | null = null;
		source.events.on('block:mined', (b) => blocks.push(b));
		source.events.on('chain:reorg', (r) => (reorg = r));

		await source.start();
		sockets[0]!.open();
		await vi.runOnlyPendingTimersAsync();

		// a block arrives whose parent is NOT our tip → resync → reorg
		sockets[0]!.message({ block: child353 });
		await vi.runOnlyPendingTimersAsync();

		expect(reorg).not.toBeNull();
		expect(reorg!.orphanedHashes).toEqual([
			'0000000000000000000123de710a04cc64d70369217c3e2845acbb3e7ab39426',
		]);
		// the replacement branch was re-emitted in order
		const tail = blocks.slice(-2);
		expect(tail.map((b) => b.index)).toEqual([953352, 953353]);
		expect(tail[0]!.hash).toBe(replacement352.id);
	});

	it('stop() closes the socket and stays stopped', async () => {
		const { source, sockets } = makeSource([restBlocksFixture]);
		await source.start();
		sockets[0]!.open();
		source.stop();
		expect(sockets[0]!.closed).toBe(true);
		expect(source.status).toBe('idle');
		await vi.advanceTimersByTimeAsync(60_000);
		expect(sockets).toHaveLength(1); // no zombie reconnects
	});
});
