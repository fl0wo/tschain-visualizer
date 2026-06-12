import { z } from 'zod';

/**
 * Wire schemas for mempool.space payloads. Everything arriving from the
 * network is validated here before it may touch domain code — don't
 * trust the wire. Schemas are deliberately LENIENT (`passthrough`, lots
 * of optionals): we validate the fields we consume and ignore the rest,
 * so upstream additions never break us, while a malformed field in
 * something we DO read fails loudly at the boundary.
 *
 * Shapes recorded from the live API (REST /api/v1/blocks and the
 * /api/v1/ws stream) — see tests/datasources/fixtures/.
 */

export const blockSchema = z
	.object({
		id: z.string(),
		height: z.number(),
		/** unix seconds (we convert to ms at the mapping boundary) */
		timestamp: z.number(),
		tx_count: z.number(),
		size: z.number().optional(),
		weight: z.number().optional(),
		previousblockhash: z.string().optional(),
		difficulty: z.number().optional(),
		nonce: z.number().optional(),
		extras: z
			.object({
				/** coinbase value in sats (subsidy + fees) */
				reward: z.number().optional(),
				/** total fees in sats */
				totalFees: z.number().optional(),
				/** median fee rate, sat/vB */
				medianFee: z.number().optional(),
				feeRange: z.array(z.number()).optional(),
				pool: z
					.object({
						id: z.number().optional(),
						name: z.string(),
						slug: z.string().optional(),
					})
					.loose()
					.optional(),
			})
			.loose()
			.optional(),
	})
	.loose();

export const restBlocksSchema = z.array(blockSchema);

/** one templated next-block of the mempool-blocks projection queue */
export const projectedBlockSchema = z
	.object({
		blockSize: z.number().optional(),
		blockVSize: z.number(),
		nTx: z.number(),
		totalFees: z.number(),
		medianFee: z.number(),
		feeRange: z.array(z.number()),
	})
	.loose();

export const mempoolInfoSchema = z.object({ size: z.number() }).loose();

export const feesSchema = z
	.object({
		fastestFee: z.number(),
		halfHourFee: z.number(),
		hourFee: z.number(),
		economyFee: z.number(),
	})
	.loose();

/**
 * A transaction of a PROJECTED block arrives as a positional tuple:
 * [txid, fee, vsize, value(sats), rate(sat/vB), flags, time, …] —
 * recorded from the live `track-mempool-block` stream. We type the
 * positions we consume and let the rest pass.
 */
export const strippedTxTupleSchema = z
	.tuple([z.string(), z.number(), z.number(), z.number()])
	.rest(z.unknown());

/** `track-mempool-block` family: full list on subscribe, deltas after */
export const projectedBlockTxsSchema = z
	.object({
		index: z.number().optional(),
		blockTransactions: z.array(strippedTxTupleSchema).optional(),
		delta: z
			.object({
				added: z.array(strippedTxTupleSchema).optional(),
				removed: z.array(z.string()).optional(),
			})
			.loose()
			.optional(),
	})
	.loose();

/** a WS frame may carry any subset of the families we subscribed to */
export const wsMessageSchema = z
	.object({
		block: blockSchema.optional(),
		blocks: z.array(blockSchema).optional(),
		'mempool-blocks': z.array(projectedBlockSchema).optional(),
		mempoolInfo: mempoolInfoSchema.optional(),
		fees: feesSchema.optional(),
		'projected-block-transactions': projectedBlockTxsSchema.optional(),
	})
	.loose();

export type MempoolBlockDto = z.infer<typeof blockSchema>;
export type ProjectedBlockDto = z.infer<typeof projectedBlockSchema>;
export type StrippedTxTuple = z.infer<typeof strippedTxTupleSchema>;
export type MempoolInfoDto = z.infer<typeof mempoolInfoSchema>;
export type FeesDto = z.infer<typeof feesSchema>;
export type WsMessage = z.infer<typeof wsMessageSchema>;
