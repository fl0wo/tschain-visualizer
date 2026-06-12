import type { DataSource } from '../../core/datasources/DataSource';
import type { BlockInfo } from '../../core/events/chainEvents';
import type { Hud } from '../view/Hud';
import type { LiveStatsPanel } from '../view/LiveStatsPanel';
import type { SceneView } from '../view/SceneView';

/**
 * # LiveBitcoinPresenter — the Controller of the live page
 *
 * Same role as the simulation's Controller, same components on the
 * other end: it translates the DataSource's events (the SAME vocabulary
 * the simulator speaks) into the shared SceneView/Hud, choosing copy
 * that explains a real network instead of a demo. No rendering, no
 * domain logic — wiring and words.
 */
export class LiveBitcoinPresenter {
	constructor(
		private readonly source: DataSource,
		private readonly view: SceneView,
		private readonly hud: Hud,
		private readonly stats: LiveStatsPanel,
	) {
		const { events } = source;

		events.on('block:mined', (block) => {
			if (block.backfill) {
				this.view.addBlock(block);
				return;
			}
			this.onLiveBlock(block);
		});

		events.on('mempool:projection', ({ blocks }) => {
			this.view.setProjection(blocks);
		});

		events.on('tx:streamed', ({ txs }) => {
			this.view.popStreamedTxs(txs);
		});

		events.on('stats:updated', (update) => this.stats.update(update));

		events.on('source:status', ({ status, retryInSec }) => {
			this.hud.setSourcePill(status, retryInSec);
			if (status === 'live') {
				this.hud.setChainStatus(true);
				this.hud.logEvent('Connected — streaming Bitcoin mainnet via mempool.space.', 'success');
			} else if (status === 'degraded' || status === 'disconnected') {
				this.hud.logEvent(
					`Connection ${status}${retryInSec ? ` — retrying in ~${retryInSec}s` : ''}. Showing last known state.`,
					'error',
				);
			}
		});

		events.on('chain:reorg', ({ orphanedHashes, newTipHeight }) => {
			this.view.markOrphaned(orphanedHashes);
			this.hud.narrator.say(
				'Chain reorganization!',
				`The network abandoned ${orphanedHashes.length} block(s) — a competing branch won the fork race up to height ${newTipHeight.toLocaleString('en-US')}. ` +
					`The grayed-out cubes were valid blocks that simply lost; their transactions return to the mempool unless the new branch includes them. ` +
					`This is probabilistic finality in the wild — and why exchanges wait for confirmations.`,
				'error',
			);
			this.hud.logEvent(`Reorg: ${orphanedHashes.length} block(s) orphaned by the network.`, 'error');
		});

		this.hud.narrator.say(
			'Connecting to Bitcoin',
			'Backfilling the most recent blocks from mempool.space, then streaming live. ' +
				'Blocks arrive roughly every 10 minutes — the amber ghosts ahead of the chain are the projected next blocks, built from the live mempool.',
		);
	}

	private onLiveBlock(block: BlockInfo): void {
		// the nearest projection ghost is what this block used to be
		this.view.consumeProjection();
		// highlight the real hash's leading zeros — actual proof-of-work
		const leadingZeros = /^0*/.exec(block.hash)?.[0].length ?? 0;
		void this.view.finishMining(block, leadingZeros);

		const miner = block.minerName ?? 'an unknown pool';
		const reward = block.rewardTotal?.toFixed(3);
		if (reward) this.view.celebrateReward(this.view.blockCount - 1, `+${reward} BTC → ${miner}`);

		this.hud.narrator.say(
			`Block ${block.index.toLocaleString('en-US')} mined by ${miner}`,
			`A real Bitcoin block: ${block.txCount?.toLocaleString('en-US') ?? '?'} transactions sealed under a hash with ${
				/^0*/.exec(block.hash)?.[0].length ?? 0
			} leading zeros. ${miner} collected ${reward ?? '?'} BTC (3.125 subsidy + ${block.fees?.toFixed(3) ?? '?'} in fees). ` +
				`Every block beneath it just became one confirmation deeper.`,
			'success',
		);
		this.hud.logEvent(
			`Block ${block.index.toLocaleString('en-US')} — ${miner}, ${block.txCount?.toLocaleString('en-US')} tx, reward ${reward} BTC.`,
			'success',
		);
	}
}
