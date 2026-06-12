/**
 * Shared primitive types for the core blockchain.
 *
 * Everything on a blockchain is ultimately bytes, but passing raw bytes
 * around is error-prone, so we use lowercase hex strings everywhere:
 * they are easy to log, compare, JSON-serialize, and display in a UI.
 */

/** A lowercase hexadecimal string (no 0x prefix). */
export type Hex = string;

/**
 * An address identifies who owns coins. In this chain (like in many real
 * ones, e.g. early Bitcoin) the address IS the public key, hex-encoded.
 * Anyone can send TO an address; only the holder of the matching private
 * key can sign transactions FROM it.
 */
export type Address = Hex;

/**
 * The plain-data shape of a transaction.
 *
 * `from` is `null` for coinbase (mining-reward) transactions: newly minted
 * coins have no sender, so there is nobody to sign them. Every other
 * transaction must carry a valid signature from the `from` key.
 */
export interface TransactionData {
	readonly from: Address | null;
	readonly to: Address;
	readonly amount: number;
	/**
	 * Per-sender counter (0, 1, 2, …). Prevents replay: a signed
	 * transaction can only be included once, at exactly its nonce position.
	 */
	readonly nonce: number;
	/** Unix epoch milliseconds when the transaction was created. */
	readonly timestamp: number;
	/** Ed25519 signature over the transaction hash; absent until signed. */
	readonly signature?: Hex;
}
