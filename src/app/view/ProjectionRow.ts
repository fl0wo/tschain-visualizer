import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import type { ProjectedBlock } from '../../core/events/chainEvents';
import { CUBE_EDGES, blockPosition } from './BlockMesh';
import { TextSprite } from './animations/TextSprite';
import { makeEdgeMaterial } from './edgeMaterials';
import { boosted, theme } from './theme';
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
