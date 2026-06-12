import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import type { ProjectedBlock, StreamedTx } from '../../core/events/chainEvents';
import { CUBE_EDGES, blockPosition } from './BlockMesh';
import { TextSprite } from './animations/TextSprite';
import { makeEdgeMaterial } from './edgeMaterials';
import { boosted, prefersReducedMotion, theme } from './theme';
import type { Tweens } from './tween';

/**
 * # ProjectionRow — the mempool projection queue (live mode's star)
 *
 * Real Bitcoin blocks land every ~10 minutes, so the idle experience is
 * the QUEUE: mempool.space continuously templates the next blocks from
 * the live mempool, and we render them as translucent amber ghost cubes
 * lined up beyond the chain tip — nearest is the projected next block —
 * each labeled with its tx count and median fee. The row reflows gently
 * as fees shift; when a real block confirms, the nearest ghost is
 * consumed and the real block grows in its place.
 *
 * Mirrors mempool.space's famous visualization, in this scene's 3D
 * language. Dormant (never fed) on simulated pages.
 */

const MAX_GHOSTS = 4;
const SIZE = theme.layout.cubeSize;
const GHOST_BODY = new THREE.MeshBasicMaterial({
	color: theme.colors.blockBody,
	transparent: true,
	opacity: 0.25,
});
const GHOST_EDGES = makeEdgeMaterial(boosted(theme.colors.pending, theme.boost.edges), theme.edgeWidth.block, {
	transparent: true,
});
GHOST_EDGES.opacity = 0.75;
const GHOST_GEOMETRY = new THREE.BoxGeometry(SIZE, SIZE, SIZE);

interface Ghost {
	group: THREE.Group;
	label: TextSprite;
}

/** unit cube for the per-tx arrival pops, scaled per pop by amount
 *  (geometry shared; material cloned per pop so each fades independently) */
const POP_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const POP_BASE_MATERIAL = new THREE.MeshBasicMaterial({
	color: boosted(theme.colors.pending, theme.boost.edges),
	transparent: true,
});

/** 0.042 → "0.042", 1.5 → "1.50", 0.0000084 → "0.000008" */
function formatBtc(value: number): string {
	if (value >= 1) return value.toFixed(2);
	if (value >= 0.001) return value.toFixed(4);
	return value.toFixed(6);
}

/**
 * BTC amounts span six orders of magnitude, so the pop cube's size maps
 * the LOG of the value: dust ≈ 0.06 world units, ~0.01 BTC ≈ 0.16,
 * 1 BTC ≈ 0.27, whale-sized ≥100 BTC caps at 0.37.
 */
function popSize(valueBtc: number): number {
	const t = Math.min(1, Math.max(0, (Math.log10(Math.max(valueBtc, 1e-5)) + 4) / 6));
	return 0.06 + t * 0.31;
}

export class ProjectionRow {
	readonly group = new THREE.Group();
	private ghosts: Ghost[] = [];

	/**
	 * Reconcile the row with the latest projection. `tipDisplayIndex` is
	 * the scene position of the current chain tip; ghost i sits at
	 * tip + 1 + i, easing into place when the queue shifts.
	 */
	update(blocks: readonly ProjectedBlock[], tipDisplayIndex: number, tweens: Tweens): void {
		const want = Math.min(blocks.length, MAX_GHOSTS);

		while (this.ghosts.length > want) this.removeLast();
		while (this.ghosts.length < want) this.addGhost();

		this.ghosts.forEach((ghost, i) => {
			const projected = blocks[i]!;
			ghost.label.set(
				[`${projected.nTx.toLocaleString('en-US')} tx`, `~${projected.medianFee.toFixed(1)} sat/vB`],
			);
			const target = blockPosition(tipDisplayIndex + 1 + i);
			if (ghost.group.position.distanceToSquared(target) > 0.0001) {
				const from = ghost.group.position.clone();
				void tweens.run(0.4, (t) => ghost.group.position.lerpVectors(from, target, t), {
					easing: theme.easing.out,
				});
			}
		});
	}

	/** A real block confirmed: the nearest ghost is consumed by it. */
	consumeNearest(): void {
		if (this.ghosts.length > 0) this.removeAt(0);
	}

	private activePops = 0;

	/**
	 * Live transactions entering the projected next block: each one pops
	 * a small cube around ghost 0 with its "+X BTC" amount rising and
	 * fading out — the heartbeat of the live page between blocks.
	 *
	 * Ornamental, so it degrades honestly: bursts beyond the concurrent
	 * cap are dropped (busy moments already read as busy), and reduced
	 * motion skips the pops entirely.
	 */
	popTransactions(txs: readonly StreamedTx[], tweens: Tweens): void {
		if (prefersReducedMotion()) return;
		const ghost = this.ghosts[0];
		if (!ghost) return;

		for (const tx of txs) {
			if (this.activePops >= 12) return;
			this.activePops++;

			const material = POP_BASE_MATERIAL.clone();
			const cube = new THREE.Mesh(POP_GEOMETRY, material);
			const size = popSize(tx.valueBtc); // bigger amount, bigger cube
			const base = ghost.group.position
				.clone()
				.add(
					new THREE.Vector3(
						(Math.random() - 0.5) * SIZE * 1.1,
						SIZE / 2 + 0.25 + Math.random() * 0.5,
						(Math.random() - 0.5) * SIZE * 1.1,
					),
				);
			cube.position.copy(base);

			const label = new TextSprite(2.4);
			label.set([`+${formatBtc(tx.valueBtc)} BTC`], { color: '#ffffff' });
			label.sprite.position.copy(base).add(new THREE.Vector3(0, 0.36, 0));
			this.group.add(cube, label.sprite);

			void tweens
				.run(1.4, (t) => {
					// pop in fast, drift up, fade out late
					cube.scale.setScalar(size * Math.min(1, t * 5));
					const rise = t * 0.9;
					cube.position.y = base.y + rise;
					label.sprite.position.y = base.y + 0.36 + rise;
					const fade = Math.max(0, (t - 0.55) / 0.45);
					material.opacity = 1 - fade;
					label.opacity = 1 - fade;
					cube.rotation.y = t * 1.8;
				})
				.finished.then(() => {
					this.group.remove(cube, label.sprite);
					material.dispose();
					label.dispose();
					this.activePops--;
				});
		}
	}

	private addGhost(): void {
		const group = new THREE.Group();
		group.add(new THREE.Mesh(GHOST_GEOMETRY, GHOST_BODY));
		group.add(new LineSegments2(CUBE_EDGES, GHOST_EDGES));
		const label = new TextSprite(2.6);
		label.sprite.position.y = SIZE / 2 + 0.7;
		group.add(label.sprite);
		// new ghosts appear at the far end of the row
		group.position.copy(blockPosition(0)); // placed properly on next update()
		this.group.add(group);
		this.ghosts.push({ group, label });
	}

	private removeAt(index: number): void {
		const [ghost] = this.ghosts.splice(index, 1);
		if (!ghost) return;
		this.group.remove(ghost.group);
		ghost.label.dispose();
	}

	private removeLast(): void {
		this.removeAt(this.ghosts.length - 1);
	}
}
