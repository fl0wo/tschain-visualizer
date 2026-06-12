import type { BlockInfo, ProjectedBlock, StatsUpdate, StreamedTx } from '../../events/chainEvents';
import type {
	FeesDto,
	MempoolBlockDto,
	MempoolInfoDto,
	ProjectedBlockDto,
	StrippedTxTuple,
} from './schemas';

/**
 * Provider DTO → domain mapping. This file is the ONLY place that knows
 * what mempool.space payloads look like; nothing past it ever sees a
 * provider field name. Units are normalized here too: sats → BTC,
 * unix seconds → milliseconds.
 */

const SATS_PER_BTC = 100_000_000;

function btc(sats: number | undefined): number | undefined {
	return sats === undefined ? undefined : sats / SATS_PER_BTC;
}

export function blockInfoFromDto(dto: MempoolBlockDto, backfill: boolean): BlockInfo {
	return {
		index: dto.height,
		hash: dto.id,
		previousHash: dto.previousblockhash ?? '0'.repeat(64),
		// a real Bitcoin nonce! the same field our PoW simulation searches
		nonce: dto.nonce ?? 0,
		timestamp: dto.timestamp * 1000,
		transactions: [], // live blocks carry density, not actors
		txCount: dto.tx_count,
		minerName: dto.extras?.pool?.name,
		rewardTotal: btc(dto.extras?.reward),
		fees: btc(dto.extras?.totalFees),
		medianFee: dto.extras?.medianFee,
		difficulty: dto.difficulty,
		weight: dto.weight,
		backfill,
		source: 'live',
	};
}

export function projectionFromDtos(dtos: readonly ProjectedBlockDto[]): ProjectedBlock[] {
	return dtos.map((p) => ({
		nTx: p.nTx,
		totalFees: btc(p.totalFees) ?? 0,
		medianFee: p.medianFee,
		feeRange: p.feeRange,
		weight: p.blockVSize,
	}));
}

/** tuple positions: [txid, fee, vsize, value(sats), rate(sat/vB), …] */
export function streamedFromTuples(tuples: readonly StrippedTxTuple[]): StreamedTx[] {
	return tuples.map((t) => ({
		txid: t[0],
		valueBtc: t[3] / SATS_PER_BTC,
		feeRate: typeof t[4] === 'number' ? t[4] : undefined,
	}));
}

export function statsFrom(info?: MempoolInfoDto, fees?: FeesDto): StatsUpdate {
	return {
		mempoolTxCount: info?.size,
		fees: fees
			? {
					fastest: fees.fastestFee,
					halfHour: fees.halfHourFee,
					hour: fees.hourFee,
					economy: fees.economyFee,
				}
			: undefined,
	};
}
