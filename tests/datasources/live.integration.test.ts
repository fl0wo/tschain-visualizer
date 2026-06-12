import { describe, expect, it } from 'vitest';
import { MempoolRestClient } from '../../src/core/datasources/mempool/restClient';
import { wsMessageSchema } from '../../src/core/datasources/mempool/schemas';

/**
 * OPT-IN integration test against the real mempool.space endpoints —
 * skipped by default (network, 30+ seconds). Run manually with:
 *
 *   LIVE=1 npx vitest run tests/datasources/live.integration.test.ts
 *
 * It asserts only schema validity of whatever arrives: the point is to
 * catch upstream payload drift, not specific chain state.
 */
describe.runIf(process.env['LIVE'] === '1')('mempool.space live endpoints', () => {
	it('REST /v1/blocks parses', async () => {
		const blocks = await new MempoolRestClient().recentBlocks();
		expect(blocks.length).toBeGreaterThan(0);
		expect(blocks[0]!.height).toBeGreaterThan(900_000);
	});

	it(
		'WS stream messages parse for 30 seconds',
		async () => {
			const ws = new WebSocket('wss://mempool.space/api/v1/ws');
			let frames = 0;
			await new Promise<void>((resolve, reject) => {
				ws.onopen = () => {
					ws.send(JSON.stringify({ action: 'want', data: ['blocks', 'mempool-blocks', 'stats'] }));
				};
				ws.onmessage = (event) => {
					frames++;
					const parsed = wsMessageSchema.safeParse(JSON.parse(String(event.data)));
					if (!parsed.success) reject(new Error(`schema drift: ${parsed.error.message}`));
				};
				ws.onerror = () => reject(new Error('socket error'));
				setTimeout(() => {
					ws.close();
					resolve();
				}, 30_000);
			});
			expect(frames).toBeGreaterThan(0);
		},
		45_000,
	);
});
