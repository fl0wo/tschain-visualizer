import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { Transaction } from './Transaction';
import type { Hex } from './types';

/** Options that make mining observable and browser-friendly. */
export interface MineOptions {
	/**
	 * How many nonce attempts to try before yielding back to the event
	 * loop. Mining is a hot loop; without yielding it would freeze the
	 * browser UI (and starve timers in Node). Lower = smoother UI,
	 * higher = faster mining.
	 */
	yieldEvery?: number;
	/** Called with the current nonce + hash attempt — lets a UI show the live search. */
	onProgress?: (nonce: number, hashAttempt: Hex) => void;
}

/**
 * # Block
 *
 * A block is a sealed batch of transactions. Its hash commits to:
 *
 * - its contents (the transactions),
 * - its position (`index`),
 * - its parent (`previousHash` — this is what chains blocks together),
 * - and a `nonce`, the one field a miner is free to vary.
 *
 * **Proof-of-work** is the rule that a block only counts if its hash
 * starts with `difficulty` zeros. Since SHA-256 output is effectively
 * random, the only way to find such a hash is brute force: try nonce
 * after nonce. That makes block production *expensive* while leaving
 * verification *cheap* (hash once, look at the prefix). The asymmetry is
 * the point: rewriting history would require redoing all that work.
 */
export class Block {
	readonly index: number;
	readonly timestamp: number;
	readonly transactions: Transaction[];
	readonly previousHash: Hex;
	/** The miner's scratch variable — incremented until the hash fits. */
	nonce: number;
	/** The block's sealed identity, set by mining (or genesis creation). */
	hash: Hex;

	constructor(data: {
		index: number;
		timestamp: number;
		transactions: Transaction[];
		previousHash: Hex;
		nonce?: number;
	}) {
		this.index = data.index;
		this.timestamp = data.timestamp;
		this.transactions = data.transactions;
		this.previousHash = data.previousHash;
		this.nonce = data.nonce ?? 0;
		this.hash = this.calculateHash();
	}

	/**
	 * SHA-256 over everything that defines this block. Note that the
	 * transactions are serialized with their signatures' *payloads* via
	 * Transaction.serialize() plus the signature itself — so swapping a
	 * signature OR a field changes the block hash.
	 *
	 * (Real chains use a Merkle tree over the transactions so light
	 * clients can verify one tx without downloading the block; a flat
	 * concatenation keeps the same security for our purposes and is far
	 * easier to follow.)
	 */
	calculateHash(): Hex {
		const txPayload = this.transactions
			.map((tx) => tx.serialize() + (tx.signature ?? ''))
			.join('|');
		const payload = `${this.index}|${this.timestamp}|${txPayload}|${this.previousHash}|${this.nonce}`;
		return bytesToHex(sha256(utf8ToBytes(payload)));
	}

	/** The proof-of-work target: `difficulty` leading hex zeros. */
	static meetsDifficulty(hash: Hex, difficulty: number): boolean {
		return hash.startsWith('0'.repeat(difficulty));
	}

	/**
	 * Brute-force search for a nonce whose hash meets the difficulty.
	 *
	 * Async on purpose: every `yieldEvery` attempts we hand control back
	 * to the event loop (`setTimeout 0`), so a browser can keep rendering
	 * frames while mining runs. This is the "async chunked loop" approach —
	 * simpler than a Web Worker, at the cost of sharing the main thread.
	 */
	async mine(difficulty: number, options: MineOptions = {}): Promise<void> {
		const yieldEvery = options.yieldEvery ?? 5_000;
		let attempt = this.calculateHash();
		let sinceYield = 0;

		while (!Block.meetsDifficulty(attempt, difficulty)) {
			this.nonce++;
			attempt = this.calculateHash();

			if (++sinceYield >= yieldEvery) {
				sinceYield = 0;
				options.onProgress?.(this.nonce, attempt);
				// A macrotask (not a microtask!) — this is what actually lets
				// the browser paint a frame between chunks of hashing.
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
		}

		this.hash = attempt;
		// Always report the final, successful attempt.
		options.onProgress?.(this.nonce, attempt);
	}
}
