import { Block } from './Block';
import { Wallet } from './Wallet';
import type { Address, Hex } from './types';

/**
 * # Blockchain
 *
 * At heart this is a **tamper-evident linked list**: each block stores the
 * hash of its parent, and each block's own hash covers ALL of its contents
 * (including that parent hash). So one edited byte anywhere in history
 * changes a hash, which breaks the next block's `previousHash` pointer,
 * which (if "fixed") changes THAT block's hash, and so on to the tip.
 * Falsifying history means redoing the proof-of-work for every block
 * after the edit — that cost is the security model.
 *
 * Note what this class does NOT have: a balances table. State (who owns
 * what) is **derived by replaying history**, never stored separately.
 * That's deliberate: if balances lived in their own table, the table and
 * the history could disagree, and you'd have to trust whoever maintains
 * the table. With derivation there is one source of truth — the chain —
 * and anyone can recompute the state from it.
 */
export class Blockchain {
	/** The chain itself. Index 0 is always the genesis block. */
	readonly blocks: Block[];
	/** Number of leading zero hex digits a block hash must have. */
	difficulty: number;

	constructor(difficulty = 2) {
		this.difficulty = difficulty;
		this.blocks = [this.createGenesisBlock()];
	}

	/**
	 * The genesis block is the one block with no parent — its
	 * `previousHash` is all zeros by convention, it carries no
	 * transactions, and it's hard-coded rather than mined: every
	 * participant must agree on the exact same starting point, so it
	 * can't be produced by anyone at runtime.
	 */
	private createGenesisBlock(): Block {
		return new Block({
			index: 0,
			timestamp: 0,
			transactions: [],
			previousHash: '0'.repeat(64),
		});
	}

	get latestBlock(): Block {
		// The chain always has at least the genesis block.
		return this.blocks[this.blocks.length - 1]!;
	}

	/**
	 * Appends a block — but only after re-checking everything a real node
	 * would check before accepting a block from an untrusted peer:
	 * linkage, internal hash consistency, and proof-of-work.
	 */
	addBlock(block: Block): void {
		if (block.previousHash !== this.latestBlock.hash) {
			throw new Error(
				`Invalid previousHash: block points at ${block.previousHash.slice(0, 8)}…, ` +
					`but the chain tip is ${this.latestBlock.hash.slice(0, 8)}…`,
			);
		}
		if (block.index !== this.latestBlock.index + 1) {
			throw new Error(`Invalid index: expected ${this.latestBlock.index + 1}, got ${block.index}`);
		}
		if (block.hash !== block.calculateHash()) {
			throw new Error('Invalid hash: the stored hash does not match the block contents');
		}
		if (!Block.meetsDifficulty(block.hash, this.difficulty)) {
			throw new Error(
				`Insufficient proof-of-work: hash must start with ${this.difficulty} zeros (difficulty)`,
			);
		}
		this.blocks.push(block);
	}

	/**
	 * Walks the WHOLE chain and re-verifies every guarantee from scratch.
	 *
	 * This method is the heart of the "tamper-evident linked list" idea,
	 * so each check is spelled out:
	 *
	 *  1. **Hash integrity** — recompute every block's hash from its
	 *     current contents and compare with the stored hash. If anyone
	 *     edited a transaction after mining, the stored hash (computed
	 *     over the OLD contents) won't match.
	 *  2. **Linkage** — each block's `previousHash` must equal the
	 *     actual hash of the block before it. This is what makes the
	 *     damage cascade: "fixing" check 1 by re-mining a tampered block
	 *     gives it a NEW hash, which breaks this check on its child.
	 *  3. **Proof-of-work** — every non-genesis hash must meet the
	 *     difficulty target, so a forger can't skip the expensive part.
	 *  4. **Signatures** — every non-coinbase transaction must carry a
	 *     valid signature from its claimed sender. Hashes prove the data
	 *     wasn't *altered*; signatures prove it was *authorized*.
	 *
	 * Returns false instead of throwing: an invalid chain is a state to
	 * report (and visualize!), not a programming error.
	 */
	isChainValid(): boolean {
		for (let i = 0; i < this.blocks.length; i++) {
			const block = this.blocks[i]!;

			// (1) hash integrity
			if (block.hash !== block.calculateHash()) return false;

			if (i > 0) {
				const parent = this.blocks[i - 1]!;
				// (2) linkage
				if (block.previousHash !== parent.hash) return false;
				// (3) proof-of-work (genesis is exempt — it's agreed, not mined)
				if (!Block.meetsDifficulty(block.hash, this.difficulty)) return false;
			}

			// (4) signatures
			for (const tx of block.transactions) {
				if (tx.isCoinbase()) continue; // minted, not sent — no signer exists
				if (!Wallet.verify(tx)) return false;
			}
		}
		return true;
	}

	/**
	 * An address's balance = (everything it ever received) minus
	 * (everything it ever sent), computed by replaying every transaction
	 * in every block. There is no balance database to drift out of sync —
	 * the history IS the state. (Slow for huge chains; real nodes cache,
	 * but the cache is always rebuildable from the chain.)
	 */
	getBalance(address: Address): number {
		let balance = 0;
		for (const block of this.blocks) {
			for (const tx of block.transactions) {
				if (tx.from === address) balance -= tx.amount;
				if (tx.to === address) balance += tx.amount;
			}
		}
		return balance;
	}

	/**
	 * The next nonce expected from `address` = how many transactions it
	 * has already gotten mined. Derived by replay, like balances.
	 */
	getNonce(address: Address): number {
		let count = 0;
		for (const block of this.blocks) {
			for (const tx of block.transactions) {
				if (tx.from === address) count++;
			}
		}
		return count;
	}

	/**
	 * How many blocks deep a transaction is buried: 1 if it's in the tip
	 * block, +1 for every block mined on top, 0 if it isn't on-chain.
	 *
	 * Why depth = security: a transaction in the tip block could still be
	 * undone by an attacker who mines a competing block at the same
	 * height. But to undo a transaction N blocks deep, the attacker must
	 * re-mine that block AND all N-1 blocks above it — and do it faster
	 * than the honest network keeps extending the chain. Each
	 * confirmation multiplies the cost, which is why exchanges wait for
	 * ~6 confirmations (in Bitcoin) before crediting a deposit.
	 */
	getConfirmations(txHash: Hex): number {
		for (let i = 0; i < this.blocks.length; i++) {
			const block = this.blocks[i]!;
			if (block.transactions.some((tx) => tx.hash() === txHash)) {
				return this.blocks.length - i;
			}
		}
		return 0;
	}
}
