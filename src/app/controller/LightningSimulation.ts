import type { StateChannelNetwork } from '../../core/layers/lightning/StateChannelNetwork';
import type { ChainModel } from '../model/ChainModel';
import { BaseSimulation } from './BaseSimulation';

/**
 * Ambient life for the Lightning page. The PARENT chain runs its own
 * PoW simulation underneath (mining funds the lightning nodes); this
 * loop opens channels as nodes become solvent, then streams off-chain
 * payments across the graph — most beats touch no chain at all, which
 * is the page's entire point. Cheats are user-triggered only.
 */
export class LightningSimulation extends BaseSimulation {
	private opening = false;

	constructor(
		private readonly network: StateChannelNetwork,
		private readonly parent: ChainModel,
		private readonly funding: number,
	) {
		super();
	}

	protected override seed(): void {
		// nodes start broke: a PoW economy mints by mining only, and the
		// page narrates that wait — channels appear as wealth does
	}

	protected override tick(): boolean {
		const open = this.network.channelList().filter((c) => c.status === 'open');
		const names = this.network.nodeNames();

		// grow the graph: connect nodes that can afford a channel
		if (open.length < names.length - 1 && !this.opening && Math.random() < 0.45) {
			if (this.tryOpenChannel(open)) return true;
		}

		// the default beat: an off-chain payment (multi-hop when lucky)
		if (open.length > 0) {
			const from = names[Math.floor(Math.random() * names.length)]!;
			const candidates = names.filter((n) => n !== from);
			const to = candidates[Math.floor(Math.random() * candidates.length)]!;
			const amount = 1 + Math.floor(Math.random() * 8);
			if (this.network.previewPath(from, to, amount)) {
				void this.network.pay(from, to, amount);
				return true;
			}
		}
		return false;
	}

	private tryOpenChannel(open: ReturnType<StateChannelNetwork['channelList']>): boolean {
		const names = this.network.nodeNames();
		const connected = (a: string, b: string) =>
			open.some((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
		const solvent = (name: string) => {
			const balance = this.parent.balances.find((w) => w.name === name)?.balance ?? 0;
			return balance >= this.funding;
		};
		for (const a of names) {
			if (!solvent(a)) continue;
			for (const b of names) {
				if (a === b || connected(a, b) || !solvent(b)) continue;
				this.opening = true;
				this.network.openChannel(a, b, this.funding, this.funding);
				// re-allow opening once the parent confirms (next blocks)
				setTimeout(() => (this.opening = false), 4_000);
				return true;
			}
		}
		return false;
	}
}
