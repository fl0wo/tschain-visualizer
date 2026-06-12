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

	private readonly bodyMaterial: THREE.MeshBasicMaterial;

	constructor(blockIndex: number, scene: THREE.Scene) {
		this.scene = scene;
		this.position = blockPosition(blockIndex);
		this.group.position.copy(this.position);

		this.bodyMaterial = new THREE.MeshBasicMaterial({
			color: theme.colors.blockBody,
			transparent: true,
			opacity: 0.3,
		});
		const body = new THREE.Mesh(GHOST_GEOMETRY, this.bodyMaterial);
		this.edgeMaterial = makeEdgeMaterial(
			boosted(theme.colors.active, theme.boost.latest),
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
	 * Found it. Lock the readout with the leading zeros highlighted —
	 * synchronous on purpose: the block must start landing in the SAME
	 * frame. A wait here (the old design) froze the scene for a beat and
	 * then released five effects at once, which read as a glitchy pop.
	 */
	lockReadout(nonce: number, hash: string, difficulty: number): void {
		this.done = true; // stop the search flicker
		this.edgeMaterial.opacity = 1;
		this.readout.set([`nonce ${nonce.toLocaleString('en-US')} ✓`, `0x${hash.slice(0, 20)}…`], {
			highlightPrefix: 2 + difficulty, // '0x' + the leading zeros
		});
	}

	/**
	 * One crisp ring expanding across the floor. Slightly delayed and
	 * starting just OUTSIDE the cube footprint, so it appears around an
	 * already-solid block (never shining through the dissolving ghost)
	 * and reads as rolling out from underneath it.
	 */
	async playShockwave(tweens: Tweens): Promise<void> {
		await tweens.wait(theme.timing.shockwaveDelay);
		const ring = new THREE.Mesh(
			RING_GEOMETRY,
			new THREE.MeshBasicMaterial({
				color: boosted(theme.colors.active, theme.boost.shockwave),
				transparent: true,
				side: THREE.DoubleSide,
				depthWrite: false,
			}),
		);
		ring.rotation.x = -Math.PI / 2;
		ring.position.set(this.position.x, 0.02, this.position.z);
		// scale 2 puts the inner radius (0.45·2 = 0.9) past the cube's
		// half-width (0.8): the ring is born at the cube's feet, not in it
		ring.scale.setScalar(2);
		this.scene.add(ring);
		await tweens.run(
			theme.timing.shockwave,
			(t) => {
				ring.scale.setScalar(2 + t * 9);
				(ring.material as THREE.MeshBasicMaterial).opacity = 1 - t;
			},
			{ easing: theme.easing.out },
		).finished;
		this.scene.remove(ring);
		(ring.material as THREE.Material).dispose();
	}

	/**
	 * The exit, in two beats: the SHELL dissolves right away (fading
	 * edges/body, drifting slightly outward — which also avoids
	 * z-fighting with the coincident real cube growing inside), while
	 * the READOUT lingers overhead so the winning hash stays readable,
	 * then fades on its own clock.
	 */
	async dissolve(tweens: Tweens): Promise<void> {
		this.done = true;
		await tweens.run(theme.timing.ghostFade, (t) => {
			this.edgeMaterial.opacity = 1 - t;
			this.bodyMaterial.opacity = 0.3 * (1 - t);
			this.group.scale.setScalar(1 + 0.08 * t);
		}).finished;
		await tweens.wait(theme.timing.mineLockHold);
		await tweens.run(0.3, (t) => (this.readout.opacity = 1 - t)).finished;
	}

	dispose(): void {
		this.scene.remove(this.group);
		this.readout.dispose();
		this.edgeMaterial.dispose();
	}
}
