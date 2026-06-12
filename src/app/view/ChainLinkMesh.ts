import * as THREE from 'three';
import { blockPosition } from './BlockMesh';
import { boosted, theme } from './theme';
import type { Tweens } from './tween';

/**
 * The `previousHash` pointer rendered as a thin light beam between
 * consecutive cubes — teal while the link verifies, red once broken.
 * Links can draw themselves in (the mined block "connecting" to its
 * parent) and the EnergyPulse below rides along them.
 */

const LINK_GEOMETRY = new THREE.BoxGeometry(1, 0.05, 0.05);
const LINK_VALID = new THREE.MeshBasicMaterial({ color: boosted(theme.colors.valid, theme.boost.edges) });
const LINK_BROKEN = new THREE.MeshBasicMaterial({ color: boosted(theme.colors.invalid, theme.boost.edges) });

export class ChainLinkMesh {
	readonly object: THREE.Mesh;
	broken = false;

	/** x where the beam starts (parent cube face) and its full length */
	private readonly startX: number;
	private readonly fullLength: number;

	/** Connects block `index-1` to block `index`. */
	constructor(index: number) {
		const from = blockPosition(index - 1);
		const to = blockPosition(index);
		const half = theme.layout.cubeSize / 2;
		this.startX = from.x + half;
		this.fullLength = to.x - half - this.startX;

		this.object = new THREE.Mesh(LINK_GEOMETRY, LINK_VALID);
		this.object.position.set(this.startX + this.fullLength / 2, from.y, 0);
		this.object.scale.x = this.fullLength;
	}

	setBroken(broken: boolean): void {
		this.broken = broken;
		this.object.material = broken ? LINK_BROKEN : LINK_VALID;
	}

	/** Grow from the parent's face toward the new block (anchored left). */
	drawIn(tweens: Tweens): Promise<void> {
		this.object.scale.x = 0.0001;
		return tweens.run(
			theme.timing.linkDraw,
			(t) => {
				const length = this.fullLength * t;
				this.object.scale.x = Math.max(length, 0.0001);
				this.object.position.x = this.startX + length / 2;
			},
			{ easing: theme.easing.out },
		).finished;
	}
}

/**
 * The signature idle animation: a single bright dot that travels the
 * whole chain from genesis to tip, over and over — data flowing through
 * the structure. When a link is broken the pulse dies at the break
 * (fades out) and respawns at genesis, so a healthy chain reads as an
 * unbroken stream and a tampered one visibly "stops conducting".
 */
export class EnergyPulse {
	readonly mesh: THREE.Mesh;
	private x = 0;
	private readonly material: THREE.MeshBasicMaterial;
	private fading = 0; // >0 while dying at a break

	constructor() {
		this.material = new THREE.MeshBasicMaterial({
			color: boosted(theme.colors.valid, theme.boost.pulse),
			transparent: true,
		});
		this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), this.material);
		this.mesh.position.copy(blockPosition(0));
	}

	/**
	 * @param tipX        x of the chain tip (wrap point)
	 * @param breakX      x of the first broken link's start, or null
	 */
	update(dt: number, tipX: number, breakX: number | null): void {
		if (tipX <= 0) {
			this.mesh.visible = false; // single-block chain: nothing to travel
			return;
		}
		this.mesh.visible = true;

		if (this.fading > 0) {
			this.fading -= dt;
			this.material.opacity = Math.max(this.fading / 0.4, 0);
			if (this.fading <= 0) {
				this.x = 0; // respawn at genesis
				this.material.opacity = 1;
			}
			return;
		}

		this.x += theme.timing.pulseSpeed * dt;
		if (breakX !== null && this.x >= breakX) {
			this.x = breakX;
			this.fading = 0.4;
		} else if (this.x > tipX) {
			this.x = 0;
		}
		this.mesh.position.x = this.x;
		this.mesh.position.y = blockPosition(0).y;
	}
}
