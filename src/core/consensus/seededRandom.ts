import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { Hex } from '../types';

/**
 * Deterministic randomness for consensus simulations.
 *
 * Proof-of-stake selection must be UNPREDICTABLE in advance yet
 * VERIFIABLE after the fact — every node has to agree on who the
 * proposer was. Real chains mix entropy collectively (Ethereum's
 * RANDAO); we model the same property with a transparent recipe:
 * seed = sha256(slot | previous block hash), fed through a tiny PRNG.
 * Deterministic, testable, and honest enough to show the seed in the
 * HUD.
 */

export function slotSeed(slot: number, previousHash: Hex): Hex {
	return bytesToHex(sha256(utf8ToBytes(`${slot}|${previousHash}`)));
}

/** mulberry32 over the first 4 bytes of a hex seed → () => [0,1) */
export function prngFromSeed(seedHex: Hex): () => number {
	let state = parseInt(seedHex.slice(0, 8), 16) >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** stake-weighted pick: heavier stake, proportionally better odds */
export function pickWeighted<T extends { stake: number }>(items: readonly T[], seedHex: Hex): T {
	const total = items.reduce((sum, item) => sum + item.stake, 0);
	let roll = prngFromSeed(seedHex)() * total;
	for (const item of items) {
		roll -= item.stake;
		if (roll <= 0) return item;
	}
	return items[items.length - 1]!;
}
