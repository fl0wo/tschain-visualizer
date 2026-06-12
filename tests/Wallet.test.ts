import { describe, it, expect } from 'vitest';
import { Transaction } from '../src/core/Transaction';
import { Wallet } from '../src/core/Wallet';

/**
 * Digital signatures are what make a blockchain trustless: you don't need
 * to ask anyone whether a transaction is authorized — the math tells you.
 *
 * These tests pin down the three properties that matter:
 *  1. A correctly signed transaction verifies.
 *  2. Tampering with signed data breaks verification (integrity).
 *  3. You cannot sign on someone else's behalf (authenticity).
 */
describe('Wallet', () => {
	const makeTx = (from: string, to: string) =>
		new Transaction({
			from,
			to,
			amount: 25,
			nonce: 0,
			timestamp: 1_700_000_000_000,
		});

	it('generates a keypair with a hex public key address', () => {
		const wallet = new Wallet();
		// Ed25519 public keys are 32 bytes → 64 hex chars.
		expect(wallet.address).toMatch(/^[0-9a-f]{64}$/);
		// Two wallets must never share keys.
		expect(new Wallet().address).not.toBe(wallet.address);
	});

	it('can be restored from a private key', () => {
		const original = new Wallet();
		const restored = new Wallet(original.privateKey);
		expect(restored.address).toBe(original.address);
	});

	it('signs a transaction that then verifies', () => {
		const alice = new Wallet();
		const bob = new Wallet();
		const tx = makeTx(alice.address, bob.address);
		alice.sign(tx);
		expect(tx.signature).toMatch(/^[0-9a-f]{128}$/); // 64-byte Ed25519 sig
		expect(Wallet.verify(tx)).toBe(true);
	});

	it('fails verification if the amount is tampered with after signing', () => {
		const alice = new Wallet();
		const bob = new Wallet();
		const tx = makeTx(alice.address, bob.address);
		alice.sign(tx);

		// Rebuild the same tx but with a different amount, keeping the old
		// signature — exactly what an attacker intercepting it would do.
		const tampered = new Transaction({
			from: tx.from,
			to: tx.to,
			amount: 9999,
			nonce: tx.nonce,
			timestamp: tx.timestamp,
			signature: tx.signature,
		});
		expect(Wallet.verify(tampered)).toBe(false);
	});

	it('rejects a signature made by a different wallet than `from` claims', () => {
		const alice = new Wallet();
		const bob = new Wallet();
		const mallory = new Wallet();

		// Mallory signs a tx that claims to be from Alice. The signature is
		// cryptographically valid — but for Mallory's key, not Alice's, so
		// verification against `from` (Alice) must fail.
		const tx = makeTx(alice.address, bob.address);
		expect(() => mallory.sign(tx)).toThrow();
	});

	it('signs and verifies arbitrary messages (channel states, not just txs)', () => {
		// Layer-2 protocols sign STATE, not transactions: a Lightning
		// channel update is a message both parties sign off-chain.
		const alice = new Wallet();
		const message = 'ch-1|7|30|20';
		const signature = alice.signMessage(message);
		expect(Wallet.verifyMessage(message, signature, alice.address)).toBe(true);
		// tampered message or wrong signer must fail
		expect(Wallet.verifyMessage('ch-1|7|31|19', signature, alice.address)).toBe(false);
		expect(Wallet.verifyMessage(message, signature, new Wallet().address)).toBe(false);
	});

	it('refuses to verify a coinbase or unsigned transaction', () => {
		const coinbase = new Transaction({
			from: null,
			to: new Wallet().address,
			amount: 100,
			nonce: 0,
			timestamp: 1_700_000_000_000,
		});
		// Coinbase txs have no signer; their validity is judged by consensus
		// rules (block reward amount), not by signature — handled later by
		// the Blockchain. Wallet.verify simply says "not signature-valid".
		expect(Wallet.verify(coinbase)).toBe(false);

		const alice = new Wallet();
		const unsigned = makeTx(alice.address, alice.address);
		expect(Wallet.verify(unsigned)).toBe(false);
	});
});
