import * as THREE from 'three';

/**
 * The glowing connector between consecutive blocks — the visual stand-in
 * for the `previousHash` pointer. Green while the link verifies; red and
 * flickering once validation finds the child's `previousHash` no longer
 * matches the parent's actual hash.
 */

// One geometry shared by every link (unit cube, scaled per instance):
// geometry is the expensive part, materials are cheap to clone.
const LINK_GEOMETRY = new THREE.BoxGeometry(1, 0.22, 0.22);

const VALID_COLOR = new THREE.Color(0x22cc66);
const BROKEN_COLOR = new THREE.Color(0xee3333);

export class ChainLinkMesh {
	readonly object: THREE.Mesh;
	private readonly material: THREE.MeshStandardMaterial;
	private broken = false;
	private elapsed = 0;

	/** Spans the gap between the facing sides of two block cubes. */
	constructor(fromCenter: THREE.Vector3, toCenter: THREE.Vector3, cubeSize: number) {
		this.material = new THREE.MeshStandardMaterial({
			color: VALID_COLOR,
			emissive: VALID_COLOR,
			emissiveIntensity: 0.9,
		});
		this.object = new THREE.Mesh(LINK_GEOMETRY, this.material);

		const gap = toCenter.x - fromCenter.x - cubeSize;
		this.object.scale.x = gap;
		this.object.position.copy(fromCenter).x += cubeSize / 2 + gap / 2;
	}

	setBroken(broken: boolean): void {
		this.broken = broken;
		const color = broken ? BROKEN_COLOR : VALID_COLOR;
		this.material.color.copy(color);
		this.material.emissive.copy(color);
		this.material.emissiveIntensity = 0.9;
	}

	/** Per-frame: a broken link flickers — impossible to miss. */
	update(dt: number): void {
		if (!this.broken) return;
		this.elapsed += dt;
		// Two unsynchronized sine waves ≈ nervous electrical flicker.
		const flicker = 0.55 + 0.45 * Math.sin(this.elapsed * 18) * Math.sin(this.elapsed * 7.3);
		this.material.emissiveIntensity = Math.max(0.15, flicker);
	}

	dispose(): void {
		this.material.dispose(); // geometry is shared — never disposed here
	}
}
