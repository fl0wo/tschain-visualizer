import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { Address, Hex, TransactionData } from './types';

/**
 * # Transaction
 *
 * A transaction is a signed statement: "I, the holder of key `from`,
 * transfer `amount` coins to `to`." Its SHA-256 hash acts as its unique
 * ID, and that hash is what the sender signs.
 *
 * The crucial subtlety is **deterministic serialization**. A signature is
 * made over bytes, so everyone who checks the signature must reconstruct
 * the *exact same bytes* from the transaction's fields. If serialization
 * could vary — fields in a different order, different number formatting —
 * the recomputed hash would differ and a perfectly valid signature would
 * fail to verify. We guarantee determinism by serializing fields in a
 * fixed, hand-written order rather than relying on object key order.
 */
export class Transaction {
	/** `null` marks a coinbase (mining-reward) transaction — see types.ts. */
	readonly from: Address | null;
	readonly to: Address;
	readonly amount: number;
	/** miner tip on top of `amount`; signed like every other field */
	readonly fee: number;
	readonly nonce: number;
	readonly timestamp: number;
	/** Mutable: a Wallet attaches this after construction. */
	signature?: Hex;

	constructor(data: TransactionData) {
		this.from = data.from;
		this.to = data.to;
		this.amount = data.amount;
		this.fee = data.fee ?? 0;
		this.nonce = data.nonce;
		this.timestamp = data.timestamp;
		this.signature = data.signature;
	}

	/** True for mining-reward transactions, which have no sender. */
	isCoinbase(): boolean {
		return this.from === null;
	}

	/**
	 * Deterministic serialization of the signable payload.
	 *
	 * - Field order is FIXED (from, to, amount, nonce, timestamp). JSON.stringify
	 *   on a literal preserves the literal's key order, so writing the literal
	 *   by hand pins the byte layout.
	 * - The signature is deliberately EXCLUDED: the signature signs this
	 *   payload's hash, so including it would be circular (you cannot sign
	 *   something that already contains the signature).
	 */
	serialize(): string {
		return JSON.stringify({
			from: this.from,
			to: this.to,
			amount: this.amount,
			fee: this.fee,
			nonce: this.nonce,
			timestamp: this.timestamp,
		});
	}

	/**
	 * SHA-256 of the serialized payload, as 64 hex chars.
	 *
	 * This is the transaction's identity AND the message that gets signed.
	 * Because SHA-256 is collision-resistant, signing the 32-byte hash is
	 * as good as signing the whole payload — and any change to any field
	 * produces a completely different hash, which is what makes tampering
	 * detectable.
	 */
	hash(): Hex {
		return bytesToHex(sha256(utf8ToBytes(this.serialize())));
	}
}
