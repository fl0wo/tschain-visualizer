import * as THREE from 'three';
import type { BlockInfo, TxInfo } from '../model/ChainModel';

/**
 * One block = one cube; its transactions hover as small spheres above it.
 * The genesis block is visually distinct (gold) because it plays by
 * different rules: agreed upon, not mined.
 *
 * Geometry/material reuse: all cubes share geometries and the sphere
 * geometry; only materials that must change per-instance (tamper tint)
 * are cloned. This is what keeps ~20 blocks × N spheres at 60fps.
 */

export const CUBE_SIZE = 2;
export const BLOCK_SPACING = 4;

const CUBE_GEOMETRY = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
const CUBE_EDGES = new THREE.EdgesGeometry(CUBE_GEOMETRY);
const TX_SPHERE_GEOMETRY = new THREE.SphereGeometry(0.18, 16, 12);

const NORMAL_MATERIAL = new THREE.MeshStandardMaterial({
	color: 0x3d6bb3,
	transparent: true,
	opacity: 0.82,
	roughness: 0.35,
	metalness: 0.25,
});
const GENESIS_MATERIAL = new THREE.MeshStandardMaterial({
	color: 0xc9a227,
	transparent: true,
	opacity: 0.88,
	roughness: 0.3,
	metalness: 0.55,
});
const TAMPERED_MATERIAL = new THREE.MeshStandardMaterial({
	color: 0xaa2222,
	transparent: true,
	opacity: 0.85,
	roughness: 0.4,
	emissive: 0x550000,
});
const EDGE_MATERIAL = new THREE.LineBasicMaterial({ color: 0xbfd4ee });

// Tx sphere materials, shared by status. Spheres never change status
// after creation (a new validation re-creates blocks' colors via tint),
// so sharing is safe.
const TX_MATERIALS = {
	coinbase: new THREE.MeshStandardMaterial({ color: 0xf5c542, emissive: 0x6e5410, emissiveIntensity: 0.5 }),
	valid: new THREE.MeshStandardMaterial({ color: 0x3fd9c0, emissive: 0x0e4f45, emissiveIntensity: 0.5 }),
	invalid: new THREE.MeshStandardMaterial({ color: 0xff4444, emissive: 0x661111, emissiveIntensity: 0.7 }),
} as const;

export function txMaterialFor(tx: TxInfo): THREE.MeshStandardMaterial {
	if (tx.coinbase) return TX_MATERIALS.coinbase;
	return tx.signatureValid ? TX_MATERIALS.valid : TX_MATERIALS.invalid;
}

/** Position of block #index on the chain axis. */
export function blockPosition(index: number): THREE.Vector3 {
	return new THREE.Vector3(index * BLOCK_SPACING, CUBE_SIZE / 2, 0);
}

/** Canvas-texture sprite for the block index label — cheap and crisp. */
function makeLabel(text: string): THREE.Sprite {
	const canvas = document.createElement('canvas');
	canvas.width = 128;
	canvas.height = 64;
	const ctx = canvas.getContext('2d')!;
	ctx.font = 'bold 40px ui-monospace, monospace';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillStyle = '#dce8f8';
	ctx.fillText(text, 64, 34);
	const texture = new THREE.CanvasTexture(canvas);
	const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
	sprite.scale.set(1.6, 0.8, 1);
	return sprite;
}

export class BlockMesh {
	readonly group: THREE.Group;
	/** Hover targets for the tooltip raycaster; userData.tx holds TxInfo. */
	readonly txSpheres: THREE.Mesh[] = [];
	readonly index: number;

	private readonly cube: THREE.Mesh;
	private pulseTime: number | null = null;

	constructor(info: BlockInfo) {
		this.index = info.index;
		this.group = new THREE.Group();
		this.group.position.copy(blockPosition(info.index));

		this.cube = new THREE.Mesh(CUBE_GEOMETRY, info.index === 0 ? GENESIS_MATERIAL : NORMAL_MATERIAL);
		this.group.add(this.cube);
		this.group.add(new THREE.LineSegments(CUBE_EDGES, EDGE_MATERIAL));

		const label = makeLabel(info.index === 0 ? 'genesis' : `#${info.index}`);
		label.position.y = -(CUBE_SIZE / 2 + 0.7);
		this.group.add(label);

		// Transactions hover in a row just above the cube's top face.
		info.transactions.forEach((tx, i) => {
			const sphere = new THREE.Mesh(TX_SPHERE_GEOMETRY, txMaterialFor(tx));
			const count = info.transactions.length;
			sphere.position.set(
				(i - (count - 1) / 2) * 0.5,
				CUBE_SIZE / 2 + 0.45,
				0,
			);
			sphere.userData.tx = tx;
			this.txSpheres.push(sphere);
			this.group.add(sphere);
		});
	}

	/** Tint the cube red once validation finds its hash no longer matches. */
	setTampered(tampered: boolean): void {
		this.cube.material = tampered
			? TAMPERED_MATERIAL
			: this.index === 0
				? GENESIS_MATERIAL
				: NORMAL_MATERIAL;
	}

	/** Brief "I just got mined" pop-in pulse. */
	celebrate(): void {
		this.pulseTime = 0;
	}

	update(dt: number): void {
		if (this.pulseTime === null) return;
		this.pulseTime += dt;
		const t = this.pulseTime;
		if (t >= 0.6) {
			this.group.scale.setScalar(1);
			this.pulseTime = null;
			return;
		}
		// Overshoot then settle: 1 → 1.15 → 1.
		this.group.scale.setScalar(1 + 0.15 * Math.sin((t / 0.6) * Math.PI));
	}
}
