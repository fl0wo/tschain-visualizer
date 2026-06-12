import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import type { Transaction } from './Transaction';
import type { Hex } from './types';

/**
 * # Wallet
 *
 * A "wallet" holds no coins. It holds a **keypair**:
 *
 * - the private key is the ability to spend — whoever knows it can sign
 *   transactions moving funds away from the matching address;
 * - the public key IS the address — coins are "at" an address simply
 *   because the chain's history says so (see Blockchain.getBalance).
 *
 * Ed25519 gives us the asymmetry that makes this work: anything signed
 * with the private key can be verified by anyone using only the public
 * key, and forging a signature without the private key is computationally
 * infeasible.
 */
export class Wallet {
	/** 32-byte Ed25519 private key, hex. Keep secret — it IS the money. */
	readonly privateKey: Hex;
	/** 32-byte Ed25519 public key, hex. Doubles as the wallet's address. */
	readonly address: Hex;

	/**
	 * Generates a fresh random keypair, or restores a wallet from an
	 * existing private key (the public key is derivable from the private
	 * key, so the private key alone is a full backup).
	 */
	constructor(privateKey?: Hex) {
		const secret = privateKey ? hexToBytes(privateKey) : ed25519.utils.randomPrivateKey();
		this.privateKey = bytesToHex(secret);
		this.address = bytesToHex(ed25519.getPublicKey(secret));
	}

	/**
	 * Signs a transaction and attaches the signature to it.
	 *
	 * We sign the transaction's SHA-256 *hash* rather than its raw bytes —
	 * the hash already commits to every field (Transaction.hash), so the
	 * signature transitively covers them all.
	 *
	 * A wallet refuses to sign a transaction whose `from` is not its own
	 * address: such a signature could never verify, and asking for it is
	 * always a bug (or an impersonation attempt).
	 */
	sign(tx: Transaction): void {
		if (tx.from !== this.address) {
			throw new Error(
				`Wallet ${this.address.slice(0, 8)}… cannot sign a transaction from ${String(tx.from).slice(0, 8)}…`,
			);
		}
		const signature = ed25519.sign(hexToBytes(tx.hash()), hexToBytes(this.privateKey));
		tx.signature = bytesToHex(signature);
	}

	/**
	 * Verifies a transaction's signature against its claimed sender.
	 *
	 * This needs NO secrets — only public data — which is why every node
	 * in a real network can independently validate every transaction.
	 * It recomputes the hash from the fields (so any tampering changes
	 * the message) and checks the signature against `tx.from` (so only
	 * the claimed sender's key can have produced it).
	 *
	 * Coinbase and unsigned transactions return false: they have no valid
	 * signature by definition. (Coinbase legitimacy is a consensus rule,
	 * checked by the Blockchain, not a signature property.)
	 */
	/**
	 * Sign an arbitrary MESSAGE (not a transaction): Layer-2 protocols
	 * sign state — a Lightning channel update is a string both parties
	 * sign off-chain. Same key, same Ed25519, same security story.
	 */
	signMessage(message: string): Hex {
		const digest = sha256(utf8ToBytes(message));
		return bytesToHex(ed25519.sign(digest, hexToBytes(this.privateKey)));
	}

	static verifyMessage(message: string, signature: Hex, address: Hex): boolean {
		try {
			const digest = sha256(utf8ToBytes(message));
			return ed25519.verify(hexToBytes(signature), digest, hexToBytes(address));
		} catch {
			return false;
		}
	}

	static verify(tx: Transaction): boolean {
		if (tx.from === null || tx.signature === undefined) return false;
		try {
			return ed25519.verify(hexToBytes(tx.signature), hexToBytes(tx.hash()), hexToBytes(tx.from));
		} catch {
			// Malformed hex / wrong lengths are "invalid", not a crash.
			return false;
		}
	}
}
