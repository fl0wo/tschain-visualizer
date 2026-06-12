import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { TextSprite } from './animations/TextSprite';
import { makeEdgeMaterial } from './edgeMaterials';
import { boosted, prefersReducedMotion, theme } from './theme';
import type { Tweens } from './tween';

/**
 * # RollupLaneView — the Base fast lane above the Ethereum chain
 *
 * Small cubes stream in at L2 pace (soft = translucent: ordered by the
 * sequencer, guaranteed by nobody yet). Periodically they COMPRESS into
 * one dense brick that drops into the L1 below — many L2 transactions,
 * one L1 transaction: that compression is the rollup's whole economy.
 * Each landed brick carries an amber challenge-window countdown ring
 * that ticks per L1 block and flips teal on finalization; a fraud
 * challenge is a red bolt from the verifier pillar that shatters the
 * brick while the lane visibly rolls back.
 */

const LANE_Y = 6.2;
const LANE_Z = -1.5;
const CUBE = 0.34;
const BASE_BLUE = 0x2151f5;

const SOFT_GEOMETRY = new THREE.BoxGeometry(CUBE, CUBE, CUBE);
const SOFT_EDGES = new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(SOFT_GEOMETRY));
const SOFT_BODY = new THREE.MeshBasicMaterial({ color: theme.colors.blockBody, transparent: true, opacity: 0.4 });
const SOFT_EDGE = makeEdgeMaterial(boosted(BASE_BLUE, 1.25), theme.edgeWidth.tx, { transparent: true });
SOFT_EDGE.opacity = 0.8;

const BRICK_GEOMETRY = new THREE.BoxGeometry(1.1, 0.7, 0.7);
const BRICK_EDGES = new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(BRICK_GEOMETRY));
const BRICK_BODY = new THREE.MeshStandardMaterial({ color: theme.colors.blockBody, roughness: 0.7 });
const BRICK_EDGE = makeEdgeMaterial(boosted(BASE_BLUE, 1.25), theme.edgeWidth.block);
const RING_GEOMETRY = new THREE.RingGeometry(0.62, 0.74, 48);

const PILLAR_GEOMETRY = new THREE.BoxGeometry(0.5, 1.8, 0.5);
const PILLAR_EDGES = new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(PILLAR_GEOMETRY));

interface Brick {
	group: THREE.Group;
	ring: THREE.Mesh;
	label: TextSprite;
}

export class RollupLaneView {
	readonly group = new THREE.Group();
	private readonly lane: THREE.Mesh[] = [];
	private readonly bricks = new Map<number, Brick>();
	private readonly verifier: THREE.Group;
	private laneAnchorX = 0;

	constructor(private readonly tweens: Tweens) {
		// lane caption
		const caption = new TextSprite(3.4);
		caption.set(['BASE — L2 fast lane', 'soft until batched']);
		caption.sprite.position.set(-4.2, LANE_Y + 1.1, LANE_Z);
		this.group.add(caption.sprite);

		// the verifier: the one honest party re-executing batches
		this.verifier = new THREE.Group();
		this.verifier.add(new THREE.Mesh(PILLAR_GEOMETRY, BRICK_BODY));
		this.verifier.add(new LineSegments2(PILLAR_EDGES, makeEdgeMaterial(boosted(theme.colors.valid, 1.0), 2)));
		const vLabel = new TextSprite(2.2);
		vLabel.set(['Verifier']);
		vLabel.sprite.position.y = 1.5;
		this.verifier.add(vLabel.sprite);
		this.verifier.position.set(-6.2, LANE_Y - 0.9, LANE_Z);
		this.group.add(this.verifier);
	}

	/** keep the lane hovering near the L1 chain tip */
	setAnchor(tipX: number): void {
		this.laneAnchorX = tipX;
	}

	/** one soft-confirmed L2 tx slides into the lane */
	softTx(): void {
		const cube = new THREE.Mesh(SOFT_GEOMETRY, SOFT_BODY);
		cube.add(new LineSegments2(SOFT_EDGES, SOFT_EDGE));
		const slot = this.lane.length;
		const target = new THREE.Vector3(this.laneAnchorX - slot * (CUBE + 0.16), LANE_Y, LANE_Z);
		cube.position.copy(target).add(new THREE.Vector3(-3, 0.8, 0));
		this.group.add(cube);
		this.lane.push(cube);
		void this.tweens.run(0.35, (t) => cube.position.lerpVectors(cube.position, target, t), {
			easing: theme.easing.out,
		});
		if (this.lane.length > 24) {
			const oldest = this.lane.shift()!;
			this.group.remove(oldest);
		}
	}

	/** the lane compresses into one dense brick that drops toward the L1 */
	postBatch(batchId: number, txCount: number, windowBlocks: number): void {
		const brickPos = new THREE.Vector3(this.laneAnchorX + 1.6, LANE_Y, LANE_Z);
		// compression: every lane cube collapses into the brick's position
		for (const cube of this.lane) {
			const from = cube.position.clone();
			void this.tweens
				.run(0.4, (t) => {
					cube.position.lerpVectors(from, brickPos, t);
					cube.scale.setScalar(Math.max(1 - t, 0.001));
				})
				.finished.then(() => this.group.remove(cube));
		}
		this.lane.length = 0;

		const group = new THREE.Group();
		group.add(new THREE.Mesh(BRICK_GEOMETRY, BRICK_BODY));
		group.add(new LineSegments2(BRICK_EDGES, BRICK_EDGE));
		const ring = new THREE.Mesh(
			RING_GEOMETRY,
			new THREE.MeshBasicMaterial({
				color: boosted(theme.colors.pending, 1.1),
				side: THREE.DoubleSide,
				transparent: true,
			}),
		);
		ring.rotation.x = -Math.PI / 2;
		ring.position.y = 0.8;
		const label = new TextSprite(2.4);
		label.set([`batch #${batchId}`, `${txCount} tx · window ${windowBlocks}`]);
		label.sprite.position.y = 1.3;
		group.add(ring, label.sprite);
		group.position.copy(brickPos);
		this.group.add(group);
		this.bricks.set(batchId, { group, ring, label });

		// the drop: one L1 transaction carrying the whole lane
		if (!prefersReducedMotion()) {
			void this.tweens.run(
				0.9,
				(t) => (group.position.y = LANE_Y - t * (LANE_Y - 2.6)),
				{ easing: theme.easing.inOut, delaySec: 0.45 },
			);
		} else {
			group.position.y = 2.6;
		}
	}

	windowTick(batchId: number, blocksLeft: number, windowBlocks: number): void {
		const brick = this.bricks.get(batchId);
		brick?.label.set([`batch #${batchId}`, `challenge: ${blocksLeft}/${windowBlocks} blocks`]);
	}

	finalize(batchId: number, valid: boolean): void {
		const brick = this.bricks.get(batchId);
		if (!brick) return;
		const color = valid ? theme.colors.valid : theme.colors.invalid;
		(brick.ring.material as THREE.MeshBasicMaterial).color = boosted(color, 1.1);
		brick.label.set([
			`batch #${batchId}`,
			valid ? 'finalized ✓ (challenge passed)' : 'finalized — INVALID, unchallenged',
		]);
		void this.tweens
			.run(3, (t) => ((brick.ring.material as THREE.MeshBasicMaterial).opacity = 1 - t * 0.9))
			.finished.then(() => this.fadeBrick(batchId, 1.2));
	}

	/** the red bolt + shatter; the lane's soft cubes fall away with it */
	challenge(batchId: number): void {
		const brick = this.bricks.get(batchId);
		if (!brick) return;
		// the bolt: a thin stretched box from the verifier to the brick
		const from = this.verifier.position.clone().add(new THREE.Vector3(0, 0.6, 0));
		const to = brick.group.position.clone();
		const bolt = new THREE.Mesh(
			new THREE.BoxGeometry(from.distanceTo(to), 0.06, 0.06),
			new THREE.MeshBasicMaterial({ color: boosted(theme.colors.invalid, 2.2), transparent: true }),
		);
		bolt.position.copy(from.clone().add(to).multiplyScalar(0.5));
		bolt.lookAt(to);
		bolt.rotateY(Math.PI / 2);
		this.group.add(bolt);
		void this.tweens.run(0.7, (t) => ((bolt.material as THREE.MeshBasicMaterial).opacity = 1 - t)).finished.then(() => {
			this.group.remove(bolt);
			(bolt.material as THREE.Material).dispose();
		});

		// shatter: jitter then collapse
		void this.tweens
			.run(0.6, (t) => {
				brick.group.rotation.z = Math.sin(t * 40) * 0.12 * (1 - t);
				brick.group.scale.setScalar(Math.max(1 - t, 0.001));
			})
			.finished.then(() => this.removeBrick(batchId));

		// the rollback: surviving soft cubes detach and fall
		for (const cube of this.lane) {
			const start = cube.position.clone();
			void this.tweens
				.run(0.9, (t) => {
					cube.position.y = start.y - t * t * 7;
					(cube.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 - t);
				})
				.finished.then(() => this.group.remove(cube));
		}
		this.lane.length = 0;
	}

	/** bridge: a deposit climbs from the L1 to the lane */
	depositCrossing(): void {
		if (prefersReducedMotion()) return;
		const cube = new THREE.Mesh(SOFT_GEOMETRY, SOFT_BODY.clone());
		cube.position.set(this.laneAnchorX - 2, 1.2, LANE_Z);
		this.group.add(cube);
		void this.tweens
			.run(1.0, (t) => (cube.position.y = 1.2 + t * (LANE_Y - 1.2)))
			.finished.then(() => this.group.remove(cube));
	}

	/** a withdrawal parks at the lane boundary until its window passes */
	private readonly parked = new Map<number, { group: THREE.Group; label: TextSprite }>();

	parkWithdrawal(id: number, text: string): void {
		let entry = this.parked.get(id);
		if (!entry) {
			const group = new THREE.Group();
			const cube = new THREE.Mesh(SOFT_GEOMETRY, SOFT_BODY.clone());
			const label = new TextSprite(2.6);
			label.sprite.position.y = 0.6;
			group.add(cube, label.sprite);
			group.position.set(this.laneAnchorX + 3.4, (LANE_Y + 1.6) / 2, LANE_Z);
			this.group.add(group);
			entry = { group, label };
			this.parked.set(id, entry);
		}
		entry.label.set(['withdrawal', text]);
	}

	completeWithdrawal(id: number): void {
		const entry = this.parked.get(id);
		if (!entry) return;
		this.parked.delete(id);
		const start = entry.group.position.clone();
		void this.tweens
			.run(0.8, (t) => (entry.group.position.y = start.y - t * (start.y - 1.0)))
			.finished.then(() => {
				this.group.remove(entry.group);
				entry.label.dispose();
			});
	}

	private fadeBrick(batchId: number, seconds: number): void {
		const brick = this.bricks.get(batchId);
		if (!brick) return;
		void this.tweens
			.run(seconds, (t) => brick.group.scale.setScalar(Math.max(1 - t, 0.001)))
			.finished.then(() => this.removeBrick(batchId));
	}

	private removeBrick(batchId: number): void {
		const brick = this.bricks.get(batchId);
		if (!brick) return;
		this.group.remove(brick.group);
		brick.label.dispose();
		this.bricks.delete(batchId);
	}
}
