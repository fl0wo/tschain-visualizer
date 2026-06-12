/**
 * Narrated end-to-end demo of the core blockchain.
 *
 *   npm run demo        (or: npx tsx src/demo.ts)
 *
 * The story: two wallets are created, one earns coins by mining, pays the
 * other, a double-spend is attempted and rejected, and finally history is
 * tampered with — and caught.
 */
import { Block } from './core/Block';
import { Blockchain } from './core/Blockchain';
import { Mempool, MINING_REWARD } from './core/Mempool';
import { Transaction } from './core/Transaction';
import { Wallet } from './core/Wallet';

const DIFFICULTY = 3;

function heading(text: string): void {
	console.log(`\n=== ${text} ===`);
}

function short(hex: string | null): string {
	return hex === null ? 'COINBASE' : `${hex.slice(0, 10)}…`;
}

function showBalances(chain: Blockchain, wallets: Record<string, Wallet>): void {
	for (const [name, wallet] of Object.entries(wallets)) {
		console.log(`  ${name.padEnd(6)} ${short(wallet.address)}  balance: ${chain.getBalance(wallet.address)}`);
	}
}

async function main(): Promise<void> {
	heading('1. Setup: a fresh chain and two wallets');
	const chain = new Blockchain(DIFFICULTY);
	const pool = new Mempool(chain);
	const alice = new Wallet();
	const bob = new Wallet();
	console.log('Genesis block hash:', short(chain.latestBlock.hash));
	showBalances(chain, { alice, bob });

	heading('2. Alice mines a block to earn her first coins');
	console.log('(an empty block still pays the coinbase reward — that is how coins are minted)');
	const block1 = await pool.minePendingTransactions(alice.address);
	console.log(`Mined block #${block1.index} with nonce ${block1.nonce}: ${short(block1.hash)}`);
	showBalances(chain, { alice, bob });

	heading('3. Alice signs and submits a payment of 40 to Bob');
	const payment = new Transaction({
		from: alice.address,
		to: bob.address,
		amount: 40,
		nonce: chain.getNonce(alice.address), // her next nonce: 0
		timestamp: Date.now(),
	});
	alice.sign(payment);
	pool.addTransaction(payment);
	console.log(`Accepted into mempool: ${short(payment.hash())} (signature verified, funds available)`);

	heading('4. Bob mines the block containing the payment');
	const block2 = await pool.minePendingTransactions(bob.address);
	console.log(`Mined block #${block2.index} with nonce ${block2.nonce}: ${short(block2.hash)}`);
	console.log(`(Bob collects the payment AND the ${MINING_REWARD} mining reward)`);
	showBalances(chain, { alice, bob });
	console.log(`Payment confirmations: ${chain.getConfirmations(payment.hash())}`);
	console.log('(each further block mined on top adds one confirmation = one more PoW an attacker must redo)');

	heading('5. Alice attempts a double-spend');
	const remaining = chain.getBalance(alice.address);
	console.log(`Alice has ${remaining}. She signs TWO transactions of ${remaining} each — both signatures are valid!`);
	const spend1 = new Transaction({
		from: alice.address, to: bob.address, amount: remaining,
		nonce: chain.getNonce(alice.address), timestamp: Date.now(),
	});
	alice.sign(spend1);
	pool.addTransaction(spend1);
	console.log(`First spend accepted: ${short(spend1.hash())}`);

	const spend2 = new Transaction({
		from: alice.address, to: bob.address, amount: remaining,
		nonce: chain.getNonce(alice.address) + 1, timestamp: Date.now(),
	});
	alice.sign(spend2);
	try {
		pool.addTransaction(spend2);
	} catch (error) {
		console.log(`Second spend REJECTED: ${(error as Error).message}`);
	}

	heading('6. Tampering with history');
	console.log(`isChainValid() before tampering: ${chain.isChainValid()}`);
	const victim = chain.blocks[2]!; // the block holding the payment
	console.log(`Editing block #2: changing the payment amount 40 → 999999 …`);
	victim.transactions[0] = new Transaction({
		from: payment.from, to: payment.to, amount: 999_999,
		nonce: payment.nonce, timestamp: payment.timestamp,
		signature: payment.signature, // the old signature no longer matches
	});
	console.log(`isChainValid() after tampering:  ${chain.isChainValid()}`);
	console.log('The stored block hash no longer matches its contents, and the old');
	console.log('signature does not cover the new amount. Even re-mining the block');
	console.log('would not help: the NEXT block still records the original hash.');

	heading('Done');
	console.log('Run `npm test` to see every one of these guarantees as a unit test.');
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

// Re-exported so this file doubles as a usage example of the full core API.
export { Block, Blockchain, Mempool, Transaction, Wallet };
