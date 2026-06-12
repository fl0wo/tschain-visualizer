import { Wallet } from '../../Wallet';
import { TypedEventEmitter } from '../../events';
import type { Hex } from '../../types';
import type { ChannelEvents, ChannelSnapshot, Layer2System, ParentL1 } from '../Layer2System';

/**
 * # StateChannelNetwork — Lightning, simplified but honest
 *
 * The bar-tab model: two parties lock funds on the L1 once (the
 * funding transaction — opening costs an L1 wait), then update a
 * PRIVATE balance sheet as often as they like. Every update is a new
 * state, numbered and REALLY signed by both parties (Ed25519 via the
 * same Wallets the chain uses); the chain hears nothing until the tab
 * is settled. Closing — cooperative or disputed — is the courtroom
 * moment: only then does the L1 see a transaction again.
 *
 * Multi-hop: payments route across connected channels with simplified
 * HTLCs (hash-lock forward, preimage-reveal backward) so intermediaries
 * can forward value they cannot steal, earning a small fee — that fee
 * is why routing nodes exist.
 *
 * The cheat game: broadcasting an OLD state opens a dispute window of
 * N L1 blocks. A watchtower answers with the newer signed state (the
 * justice transaction) and the cheater forfeits everything; with the
 * watchtower off, the stale state pays out — both outcomes shown.
 *
 * Simplifications, stated: the channel "2-of-2 multisig" is a vault
 * wallet whose keys this module holds; real LN uses revocation keys +
 * penalty transactions, onion routing, and CSV timelock delays.
 */

interface ChannelState {
	balanceA: number;
	balanceB: number;
	stateNumber: number;
	sigA: Hex;
	sigB: Hex;
}

interface Channel {
	id: string;
	a: { name: string; wallet: Wallet };
	b: { name: string; wallet: Wallet };
	/** the stand-in for the 2-of-2 multisig: holds the locked funds on L1 */
	vault: Wallet;
	status: ChannelSnapshot['status'];
	state: ChannelState;
	/** full signed history — what makes the cheat game playable */
	history: ChannelState[];
	fundingTxHashes: Hex[];
	dispute?: { broadcastState: ChannelState; cheater: 'a' | 'b'; blocksLeft: number };
}

export interface LightningOptions {
	nodes: ReadonlyArray<{ name: string; wallet: Wallet }>;
	hopFee: number;
	disputeWindowBlocks: number;
	watchtower: boolean;
	/** pause between HTLC hops, for the view's staggered animation */
	hopMs: number;
}

export class StateChannelNetwork implements Layer2System<ChannelEvents> {
	readonly kind = 'state-channel' as const;
	readonly events = new TypedEventEmitter<ChannelEvents>();
	/** the cheat-game switch: who is watching the chain? */
	watchtower: boolean;

	private readonly channels = new Map<string, Channel>();
	private channelCounter = 0;
	private paymentCounter = 0;
	private unsubscribe: (() => void) | null = null;

	constructor(
		private readonly parent: ParentL1,
		private readonly options: LightningOptions,
	) {
		this.watchtower = options.watchtower;
	}

	start(): void {
		// L1 blocks are the only clock: funding confirmations, dispute
		// windows and closings all advance per parent block.
		this.unsubscribe = this.parent.events.on('block:mined', () => this.onParentBlock());
	}

	stop(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	// ── lifecycle ──────────────────────────────────────────────────────

	/** Lock funds on the L1; the channel is unusable until that confirms. */
	openChannel(aName: string, bName: string, fundingA: number, fundingB: number): string {
		const a = this.node(aName);
		const b = this.node(bName);
		const vault = new Wallet();
		const id = `ch-${++this.channelCounter}`;

		const fundingTxHashes: Hex[] = [];
		for (const [party, amount] of [
			[a, fundingA],
			[b, fundingB],
		] as const) {
			if (amount <= 0) continue;
			fundingTxHashes.push(
				this.parent.submitSettlement({
					kind: 'channel-open',
					from: party.wallet,
					to: vault.address,
					amount,
					memo: `${id}|funding`,
				}),
			);
		}

		const state: ChannelState = { balanceA: fundingA, balanceB: fundingB, stateNumber: 0, sigA: '', sigB: '' };
		this.signState(id, state, a.wallet, b.wallet);
		const channel: Channel = {
			id,
			a,
			b,
			vault,
			status: 'funding',
			state,
			history: [{ ...state }],
			fundingTxHashes,
		};
		this.channels.set(id, channel);
		this.events.emit('channel:funding-pending', {
			channelId: id,
			a: aName,
			b: bName,
			fundingTxHash: fundingTxHashes[0] ?? '',
		});
		return id;
	}

	/** Cooperative close: the vault pays out exactly the LATEST state. */
	closeChannel(id: string): void {
		const channel = this.mustGet(id);
		if (channel.status !== 'open') throw new Error(`channel ${id} is ${channel.status}`);
		channel.status = 'closing';
		const settlementTxHash = this.settle(channel, channel.state);
		this.events.emit('channel:close-pending', { channelId: id, settlementTxHash });
	}

	// ── payments ───────────────────────────────────────────────────────

	/**
	 * Route a payment, multi-hop if needed. Atomic by construction: the
	 * route is liquidity-checked end-to-end BEFORE any state advances —
	 * a gap at any hop fails the whole payment (in real HTLCs the locks
	 * simply expire; we check upfront and say so).
	 */
	async pay(fromName: string, toName: string, amount: number): Promise<boolean> {
		const paymentId = ++this.paymentCounter;
		const path = this.findPath(fromName, toName, amount);
		if (!path) {
			this.events.emit('payment:failed', {
				paymentId,
				reason: `no route with enough liquidity from ${fromName} to ${toName} for ${amount}`,
				atHop: 0,
			});
			return false;
		}

		this.events.emit('payment:routed', {
			paymentId,
			path: path.map((hop) => hop.fromName).concat(toName),
			amount,
			feePerHop: this.options.hopFee,
		});

		// HTLC choreography: locks travel FORWARD along the path…
		for (let i = 0; i < path.length; i++) {
			await this.wait(this.options.hopMs);
			this.events.emit('payment:hop', { paymentId, hop: i, phase: 'lock' });
		}
		// …the preimage travels BACKWARD, settling each hop. This reverse
		// order is why an intermediary can't steal: it only learns the
		// secret that unlocks its incoming hop by paying the outgoing one.
		for (let i = path.length - 1; i >= 0; i--) {
			await this.wait(this.options.hopMs);
			const hop = path[i]!;
			this.applyUpdate(hop.channel, hop.direction, hop.carry);
			this.events.emit('payment:hop', { paymentId, hop: i, phase: 'reveal' });
		}
		return true;
	}

	// ── the cheat game ─────────────────────────────────────────────────

	/** A party broadcasts an OUTDATED state to the L1. Court is now open. */
	attemptCheat(channelId: string, oldStateNumber: number): void {
		const channel = this.mustGet(channelId);
		const broadcastState = channel.history.find((s) => s.stateNumber === oldStateNumber);
		if (!broadcastState) throw new Error(`no state #${oldStateNumber} in ${channelId}`);
		// the cheater is whoever the stale state favors
		const latest = channel.state;
		const cheater = broadcastState.balanceA - latest.balanceA > 0 ? 'a' : 'b';
		channel.status = 'disputed';
		channel.dispute = {
			broadcastState,
			cheater,
			blocksLeft: this.options.disputeWindowBlocks,
		};
		this.events.emit('channel:disputed', {
			channelId,
			cheater: channel[cheater].name,
			broadcastStateNumber: broadcastState.stateNumber,
			latestStateNumber: latest.stateNumber,
			windowBlocks: this.options.disputeWindowBlocks,
		});
	}

	// ── queries (for views and tests) ──────────────────────────────────

	channel(id: string): ChannelSnapshot & { state: ChannelState } {
		const c = this.mustGet(id);
		return {
			channelId: c.id,
			a: c.a.name,
			b: c.b.name,
			balanceA: c.state.balanceA,
			balanceB: c.state.balanceB,
			stateNumber: c.state.stateNumber,
			status: c.status,
			state: c.state,
		};
	}

	channelList(): ChannelSnapshot[] {
		return [...this.channels.keys()].map((id) => this.channel(id));
	}

	nodeNames(): string[] {
		return this.options.nodes.map((n) => n.name);
	}

	/** invariant hook: off-chain updates must never create or destroy funds */
	totalChannelFunds(): number {
		let total = 0;
		for (const c of this.channels.values()) {
			if (c.status === 'open' || c.status === 'funding') total += c.state.balanceA + c.state.balanceB;
		}
		return total;
	}

	/** the route a payment WOULD take (for the composer's preview) */
	previewPath(fromName: string, toName: string, amount: number): string[] | null {
		const path = this.findPath(fromName, toName, amount);
		return path ? [...path.map((hop) => hop.fromName), toName] : null;
	}

	/** the exact message both parties sign for a state — public so tests
	 *  (and curious users) can verify the signatures themselves */
	stateMessage(channelId: string, state: { balanceA: number; balanceB: number; stateNumber: number }): string {
		return `${channelId}|${state.stateNumber}|${state.balanceA}|${state.balanceB}`;
	}

	// ── internals ──────────────────────────────────────────────────────

	private onParentBlock(): void {
		for (const channel of this.channels.values()) {
			if (channel.status === 'funding') {
				const confirmed = channel.fundingTxHashes.every(
					(hash) => this.parent.getConfirmations(hash) >= 1,
				);
				if (confirmed) {
					channel.status = 'open';
					this.events.emit('channel:opened', {
						channelId: channel.id,
						a: channel.a.name,
						b: channel.b.name,
						balanceA: channel.state.balanceA,
						balanceB: channel.state.balanceB,
					});
				}
			} else if (channel.status === 'disputed' && channel.dispute) {
				this.adjudicate(channel);
			} else if (channel.status === 'closing') {
				channel.status = 'closed';
				this.events.emit('channel:closed', {
					channelId: channel.id,
					finalA: channel.state.balanceA,
					finalB: channel.state.balanceB,
				});
			}
		}
	}

	/** one dispute beat per L1 block: justice answers, or the clock runs out */
	private adjudicate(channel: Channel): void {
		const dispute = channel.dispute!;
		if (this.watchtower) {
			// the counterparty publishes the NEWER dual-signed state: the
			// cheater's entire balance is forfeited to the victim
			const victim = dispute.cheater === 'a' ? 'b' : 'a';
			const total = channel.state.balanceA + channel.state.balanceB;
			const punished: ChannelState = {
				...channel.state,
				balanceA: victim === 'a' ? total : 0,
				balanceB: victim === 'b' ? total : 0,
			};
			this.settle(channel, punished, 'justice');
			channel.status = 'closed';
			channel.dispute = undefined;
			this.events.emit('dispute:resolved', {
				channelId: channel.id,
				outcome: 'justice',
				penaltyTo: channel[victim].name,
			});
			this.events.emit('channel:closed', {
				channelId: channel.id,
				finalA: punished.balanceA,
				finalB: punished.balanceB,
			});
			return;
		}

		dispute.blocksLeft--;
		this.events.emit('dispute:tick', { channelId: channel.id, blocksLeft: dispute.blocksLeft });
		if (dispute.blocksLeft > 0) return;

		// nobody watched: the stale state pays out — the cheat succeeded
		this.settle(channel, dispute.broadcastState);
		channel.status = 'closed';
		channel.dispute = undefined;
		this.events.emit('dispute:resolved', { channelId: channel.id, outcome: 'cheat-succeeded' });
		this.events.emit('channel:closed', {
			channelId: channel.id,
			finalA: dispute.broadcastState.balanceA,
			finalB: dispute.broadcastState.balanceB,
		});
	}

	/** vault pays out a state's balances on the L1 */
	private settle(channel: Channel, state: ChannelState, kind: 'channel-close' | 'justice' = 'channel-close'): Hex {
		let lastHash: Hex = '';
		for (const [party, amount] of [
			[channel.a, state.balanceA],
			[channel.b, state.balanceB],
		] as const) {
			if (amount <= 0) continue;
			lastHash = this.parent.submitSettlement({
				kind,
				from: channel.vault,
				to: party.wallet.address,
				amount,
				memo: `${channel.id}|state ${state.stateNumber}`,
			});
		}
		return lastHash;
	}

	/** advance a channel's state by one dual-signed update */
	private applyUpdate(channel: Channel, direction: 'a→b' | 'b→a', amount: number): void {
		const next: ChannelState = {
			balanceA: channel.state.balanceA + (direction === 'a→b' ? -amount : amount),
			balanceB: channel.state.balanceB + (direction === 'a→b' ? amount : -amount),
			stateNumber: channel.state.stateNumber + 1,
			sigA: '',
			sigB: '',
		};
		this.signState(channel.id, next, channel.a.wallet, channel.b.wallet);
		channel.state = next;
		channel.history.push({ ...next });
		this.events.emit('channel:updated', {
			channelId: channel.id,
			stateNumber: next.stateNumber,
			balanceA: next.balanceA,
			balanceB: next.balanceB,
		});
	}

	private signState(channelId: string, state: ChannelState, a: Wallet, b: Wallet): void {
		const message = this.stateMessage(channelId, state);
		state.sigA = a.signMessage(message);
		state.sigB = b.signMessage(message);
	}

	/**
	 * BFS over OPEN channels with end-to-end liquidity precheck. Hop i
	 * must carry amount + hopFee × (intermediaries after it) — the fees
	 * peel off at each routing node.
	 */
	private findPath(
		fromName: string,
		toName: string,
		amount: number,
	): Array<{ channel: Channel; direction: 'a→b' | 'b→a'; fromName: string; carry: number }> | null {
		const queue: Array<{ name: string; path: Array<{ channel: Channel; direction: 'a→b' | 'b→a'; fromName: string }> }> = [
			{ name: fromName, path: [] },
		];
		const visited = new Set([fromName]);
		while (queue.length > 0) {
			const { name, path } = queue.shift()!;
			if (name === toName) {
				// liquidity precheck with per-hop carry amounts
				const intermediaries = path.length - 1;
				const withCarry = path.map((hop, i) => ({
					...hop,
					carry: amount + this.options.hopFee * (intermediaries - i),
				}));
				const liquid = withCarry.every(({ channel, direction, carry }) =>
					direction === 'a→b' ? channel.state.balanceA >= carry : channel.state.balanceB >= carry,
				);
				return liquid ? withCarry : null;
			}
			for (const channel of this.channels.values()) {
				if (channel.status !== 'open') continue;
				for (const [direction, near, far] of [
					['a→b', channel.a.name, channel.b.name],
					['b→a', channel.b.name, channel.a.name],
				] as const) {
					if (near !== name || visited.has(far)) continue;
					visited.add(far);
					queue.push({ name: far, path: [...path, { channel, direction, fromName: near }] });
				}
			}
		}
		return null;
	}

	private node(name: string): { name: string; wallet: Wallet } {
		const node = this.options.nodes.find((n) => n.name === name);
		if (!node) throw new Error(`unknown lightning node "${name}"`);
		return node;
	}

	private mustGet(id: string): Channel {
		const channel = this.channels.get(id);
		if (!channel) throw new Error(`unknown channel ${id}`);
		return channel;
	}

	private wait(ms: number): Promise<void> {
		return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
	}
}
