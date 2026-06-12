import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { CUBE_EDGES, blockPosition } from '../BlockMesh';
import { makeEdgeMaterial } from '../edgeMaterials';
import { boosted, prefersReducedMotion, theme } from '../theme';
import type { Tweens } from '../tween';
import { TextSprite } from './TextSprite';

/**
 * # MiningAnimation
 *
 * The proof-of-work search made visible: a translucent ghost cube sits
 * at the chain tip with blue flickering edges, and a Geist Mono readout
 * above it cycles the live nonce + candidate hash (throttled to ~10
 * updates/s — the real search runs far faster than a human can read).
 *
 * On success the readout locks in and the leading zeros — the entire
 * point of the search — highlight in teal, then a single crisp
 * shockwave ring expands across the floor grid.
 */

const SIZE = theme.layout.cubeSize;
const GHOST_GEOMETRY = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
const RING_GEOMETRY = new THREE.RingGeometry(0.45, 0.55, 64);

export class MiningAnimation {
	private readonly group = new THREE.Group();
	private readonly edgeMaterial: LineMaterial;
	private readonly readout: TextSprite;
	private readonly scene: THREE.Scene;
	private readonly position: THREE.Vector3;
	private lastReadoutAt = 0;
	private flickerTime = 0;
	private done = false;

	constructor(blockIndex: number, scene: THREE.Scene) {
		this.scene = scene;
		this.position = blockPosition(blockIndex);
		this.group.position.copy(this.position);

		const body = new THREE.Mesh(
			GHOST_GEOMETRY,
			new THREE.MeshBasicMaterial({ color: theme.colors.blockBody, transparent: true, opacity: 0.3 }),
		);
		this.edgeMaterial = makeEdgeMaterial(
			boosted(theme.colors.blue, theme.boost.edges * 1.6),
			theme.edgeWidth.block,
			{ transparent: true },
		);
		this.group.add(body, new LineSegments2(CUBE_EDGES, this.edgeMaterial));

		this.readout = new TextSprite(3.4);
		this.readout.sprite.position.y = SIZE / 2 + 0.9;
		this.readout.set(['mining…']);
		this.group.add(this.readout.sprite);

		scene.add(this.group);
	}

	/** Live nonce/hash feed, throttled for readability. */
	updateReadout(nonce: number, hashAttempt: string): void {
		const now = performance.now();
		if (now - this.lastReadoutAt < 1000 / theme.timing.readoutHz) return;
		this.lastReadoutAt = now;
		this.readout.set([`nonce ${nonce.toLocaleString('en-US')}`, `0x${hashAttempt.slice(0, 20)}…`]);
	}

	/** Per-frame: the nervous blue edge flicker of an ongoing search. */
	update(dt: number): void {
		if (this.done || prefersReducedMotion()) return;
		this.flickerTime += dt;
		// Two incommensurate sines ≈ electric flicker without RNG noise.
		this.edgeMaterial.opacity =
			0.65 + 0.35 * Math.sin(this.flickerTime * 23) * Math.sin(this.flickerTime * 9.7);
	}

	/**
	 * Found it. Lock the readout with the leading zeros in teal, hold a
	 * beat so the user can see WHY this hash wins, fire the shockwave.
	 */
	async succeed(nonce: number, hash: string, difficulty: number, tweens: Tweens): Promise<void> {
		this.done = true;
		this.edgeMaterial.opacity = 1;
		this.readout.set([`nonce ${nonce.toLocaleString('en-US')} ✓`, `0x${hash.slice(0, 20)}…`], {
			highlightPrefix: 2 + difficulty, // '0x' + the leading zeros
		});
		await tweens.wait(theme.timing.mineLockHold);

		// One crisp shockwave ring expanding across the floor.
		const ring = new THREE.Mesh(
			RING_GEOMETRY,
			new THREE.MeshBasicMaterial({
				color: boosted(theme.colors.blue, theme.boost.shockwave),
				transparent: true,
				side: THREE.DoubleSide,
				depthWrite: false,
			}),
		);
		ring.rotation.x = -Math.PI / 2;
		ring.position.set(this.position.x, 0.02, this.position.z);
		this.scene.add(ring);
		await tweens.run(
			theme.timing.shockwave,
			(t) => {
				ring.scale.setScalar(1 + t * 9);
				(ring.material as THREE.MeshBasicMaterial).opacity = 1 - t;
			},
			{ easing: theme.easing.out },
		).finished;
		this.scene.remove(ring);
		(ring.material as THREE.Material).dispose();
	}

	dispose(): void {
		this.scene.remove(this.group);
		this.readout.dispose();
		this.edgeMaterial.dispose();
	}
}
