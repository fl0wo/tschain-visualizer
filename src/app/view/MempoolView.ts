import * as THREE from 'three';
import type { TxInfo } from '../model/ChainModel';
import { TxCubeMesh } from './TxCubeMesh';
import { prefersReducedMotion, theme } from './theme';
import type { Tweens } from './tween';

/**
 * The mempool zone: a small holding grid floating beside the chain tip
 * where pending transaction cubes wait, gently bobbing. Cubes arrive at
 * a "staging" spot (where the signing/verification choreography plays),
 * then settle into a slot; when a block is mined the mined cubes fly
 * into it with staggered, eased arcs.
 */

interface PoolEntry {
	cube: TxCubeMesh;
	/** local-space resting position once settled */
	home: THREE.Vector3;
	/** desynchronizes the bobbing */
	phase: number;
	/** bobbing only applies once the intro choreography is done */
	settled: boolean;
}

export class MempoolView {
	readonly group = new THREE.Group();
	private readonly entries = new Map<string, PoolEntry>();
	private elapsed = 0;
	private slotCounter = 0;
	private anchorX = 0;

	/** hover targets for the tooltip raycaster */
	get hoverTargets(): THREE.Mesh[] {
		return [...this.entries.values()].map((e) => e.cube.body);
	}

	get size(): number {
		return this.entries.size;
	}

	/** Keep the holding zone floating beside the chain tip. The group
	 *  eases toward the new anchor in update() instead of teleporting. */
	setAnchor(tipX: number): void {
		this.anchorX = tipX;
	}

	/** World-space point where new cubes materialize for their intro. */
	stagingWorldPosition(): THREE.Vector3 {
		return this.group.localToWorld(
			theme.layout.mempoolOffset.clone().add(theme.layout.stagingOffset),
		);
	}

	/**
	 * Register a new pending tx cube at the staging spot. The cube is
	 * tracked immediately — even mid-choreography — so a block mined at
	 * the wrong moment can still find and drain it.
	 */
	enter(tx: TxInfo, cube: TxCubeMesh): void {
		const slot = this.slotCounter++;
		const home = theme.layout.mempoolOffset
			.clone()
			.add(new THREE.Vector3((slot % 3) * 0.85 - 0.85, Math.floor(slot % 9 / 3) * 0.85, (Math.floor(slot / 9) % 2) * 0.7));
		cube.group.position.copy(theme.layout.mempoolOffset).add(theme.layout.stagingOffset);
		this.group.add(cube.group);
		this.entries.set(tx.hash, { cube, home, phase: Math.random() * Math.PI * 2, settled: false });
	}

	/** Glide a cube from wherever it is into its resting slot. */
	async settle(txHash: string, tweens: Tweens): Promise<void> {
		const entry = this.entries.get(txHash);
		if (!entry) return; // already drained into a block mid-intro
		const from = entry.cube.group.position.clone();
		const handle = tweens.run(0.45, (t) => {
			entry.cube.group.position.lerpVectors(from, entry.home, t);
		});
		entry.cube.activeHandles.push(handle);
		await handle.finished;
		entry.settled = true;
	}

	/**
	 * MiningAnimation's final beat: the mined cubes fly to the freshly
	 * mined block with eased arcs, staggered so the eye can follow them.
	 * Cubes still mid-intro are cut short — history won't wait.
	 *
	 * Flights happen in WORLD space: the pool group itself is easing
	 * toward the new chain tip during the drain, so a cube flying in
	 * group-local coordinates would drift with it and land one block
	 * too far. Reparenting to the scene pins the path to the ground.
	 */
	async drainInto(worldTarget: THREE.Vector3, minedHashes: Iterable<string>, tweens: Tweens): Promise<void> {
		const scene = this.group.parent;
		const flights: Promise<void>[] = [];
		let order = 0;
		for (const hash of minedHashes) {
			const entry = this.entries.get(hash);
			if (!entry) continue; // coinbase never had a pool cube
			this.entries.delete(hash);
			entry.cube.cancelIntro();

			const from = entry.cube.group.getWorldPosition(new THREE.Vector3());
			this.group.remove(entry.cube.group);
			scene?.add(entry.cube.group);
			entry.cube.group.position.copy(from);

			const delaySec = (order++ * theme.timing.txFlightStaggerMs) / 1000;
			flights.push(
				tweens
					.run(
						theme.timing.txFlight,
						(t) => {
							entry.cube.group.position.lerpVectors(from, worldTarget, t);
							// the arc: a sine bump on top of the straight path
							entry.cube.group.position.y += Math.sin(t * Math.PI) * 1.1;
						},
						{ delaySec },
					)
					.finished.then(() => {
						scene?.remove(entry.cube.group);
					}),
			);
		}
		await Promise.all(flights);
	}

	/** Remove a rejected cube's tracking (its mesh tumbles separately). */
	discard(cube: TxCubeMesh): void {
		this.group.remove(cube.group);
	}

	update(dt: number): void {
		if (prefersReducedMotion()) {
			this.group.position.x = this.anchorX;
			return;
		}
		// exponential ease toward the anchor — frame-rate independent
		this.group.position.x += (this.anchorX - this.group.position.x) * Math.min(dt * 4, 1);
		this.elapsed += dt;
		const omega = (Math.PI * 2) / theme.timing.bobPeriod;
		for (const entry of this.entries.values()) {
			if (!entry.settled) continue;
			entry.cube.group.position.y =
				entry.home.y + theme.timing.bobAmplitude * Math.sin(this.elapsed * omega + entry.phase);
		}
	}
}
