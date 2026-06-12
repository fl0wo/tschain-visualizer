import { describe, expect, it } from 'vitest';
import { MempoolRestClient } from '../../src/core/datasources/mempool/restClient';
import restBlocksFixture from './fixtures/rest-blocks.json';

describe('MempoolRestClient', () => {
	it('validates and caches blocks by hash — a hash is never fetched twice', async () => {
		const calls: string[] = [];
		const client = new MempoolRestClient(async (url) => {
			calls.push(url);
			return { ok: true, status: 200, json: async () => restBlocksFixture };
		});

		const blocks = await client.recentBlocks();
		expect(blocks).toHaveLength(3);

		// every block from the list landed in the cache → no second request
		const cached = await client.block(blocks[0]!.id);
		expect(cached.height).toBe(953352);
		expect(calls).toHaveLength(1);
	});

	it('rejects malformed payloads at the boundary', async () => {
		const client = new MempoolRestClient(async () => ({
			ok: true,
			status: 200,
			json: async () => [{ id: 12345, height: 'not-a-number' }],
		}));
		await expect(client.recentBlocks()).rejects.toThrow();
	});

	it('surfaces HTTP failures with the endpoint name', async () => {
		const client = new MempoolRestClient(async () => ({
			ok: false,
			status: 429,
			json: async () => ({}),
		}));
		await expect(client.recentBlocks()).rejects.toThrow(/429/);
	});
});
