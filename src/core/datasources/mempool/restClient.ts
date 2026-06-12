import {
	blockSchema,
	miningPoolsSchema,
	restBlocksSchema,
	type MempoolBlockDto,
	type MiningPoolsDto,
} from './schemas';

/**
 * Minimal fetch shape — injectable so tests never touch the network and
 * a future adapter could route through a proxy without code changes.
 */
export type FetchLike = (url: string) => Promise<{
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
}>;

/**
 * Typed REST client for the few mempool.space endpoints we use: one
 * method per endpoint, every response zod-validated at the boundary,
 * and block lookups cached by hash — block data is immutable, so a hash
 * is never fetched twice (respecting the public API's goodwill).
 */
export class MempoolRestClient {
	private readonly byHash = new Map<string, MempoolBlockDto>();

	constructor(
		private readonly fetchFn: FetchLike = (url) => fetch(url),
		private readonly baseUrl = 'https://mempool.space/api',
	) {}

	/** GET /v1/blocks — the ~10 most recent blocks, newest first. */
	async recentBlocks(): Promise<MempoolBlockDto[]> {
		const dtos = restBlocksSchema.parse(await this.get('/v1/blocks'));
		for (const dto of dtos) this.byHash.set(dto.id, dto);
		return dtos;
	}

	/** GET /v1/mining/pools/24h — pool distribution over the last day.
	 *  Not cached: it changes with every block (callers throttle). */
	async miningPools(): Promise<MiningPoolsDto> {
		return miningPoolsSchema.parse(await this.get('/v1/mining/pools/24h'));
	}

	/** GET /block/:hash — detail for one block; cached forever by hash. */
	async block(hash: string): Promise<MempoolBlockDto> {
		const cached = this.byHash.get(hash);
		if (cached) return cached;
		const dto = blockSchema.parse(await this.get(`/block/${hash}`));
		this.byHash.set(dto.id, dto);
		return dto;
	}

	private async get(path: string): Promise<unknown> {
		const res = await this.fetchFn(`${this.baseUrl}${path}`);
		if (!res.ok) throw new Error(`mempool.space ${path} responded ${res.status}`);
		return res.json();
	}
}
