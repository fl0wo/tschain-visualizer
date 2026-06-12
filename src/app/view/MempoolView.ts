import * as THREE from 'three';
import type { TxInfo } from '../model/ChainModel';
import { txMaterialFor } from './BlockMesh';

/**
 * The mempool floats above the chain: each pending transaction is a
 * bobbing sphere in a holding pattern. When a block is mined the spheres
 * fly into the new cube (visually: "the mempool drains into the block");
 * a rejected transaction flashes red and falls off the world instead.
 */

const SPHERE_GEOMETRY = new THREE.SphereGeometry(0.24, 16, 12);
const REJECT_MATERIAL = new THREE.MeshStandardMaterial({
	color: 0xff3333,
	emissive: 0xff0000,
	emissiveIntensity: 1.2,
	transparent: true,
});

/** Where pending tx spheres hover, relative to the world origin. */
const POOL_CENTER = new THREE.Vector3(0, 7, -2.5);

interface PendingSphere {
	mesh: THREE.Mesh;
	home: THREE.Vector3;
	phase: number; // desynchronizes the bobbing
}

interface FlyingSphere {
	mesh: THREE.Mesh;
	from: THREE.Vector3;
	to: THREE.Vector3;
	t: number;
}

interface FallingSphere {
	mesh: THREE.Mesh;
	velocity: THREE.Vector3;
	life: number;
}

export class MempoolView {
	readonly group = new THREE.Group();
	private pending = new Map<string, PendingSphere>();
	private flying: FlyingSphere[] = [];
	private falling: FallingSphere[] = [];
	private elapsed = 0;

	/** Hover targets for the tooltip raycaster. */
	get spheres(): THREE.Mesh[] {
		return [...this.pending.values()].map((p) => p.mesh);
	}

	/** Keep the holding pattern hovering near the end of the chain. */
	setAnchor(x: number): void {
		this.group.position.x = x;
	}

	add(tx: TxInfo): void {
		const mesh = new THREE.Mesh(SPHERE_GEOMETRY, txMaterialFor(tx));
		mesh.userData.tx = tx;
		const slot = this.pending.size;
		const home = POOL_CENTER.clone().add(
			new THREE.Vector3((slot % 4) * 0.8 - 1.2, Math.floor(slot / 4) * 0.8, 0),
		);
		mesh.position.copy(home);
		this.group.add(mesh);
		this.pending.set(tx.hash, { mesh, home, phase: Math.random() * Math.PI * 2 });
	}

	/**
	 * Mined! Send every pending sphere flying into the new block. The
	 * target is given in world space; convert to this group's local space
	 * since the group itself is offset by setAnchor().
	 */
	drainInto(worldTarget: THREE.Vector3): void {
		const localTarget = this.group.worldToLocal(worldTarget.clone());
		for (const { mesh } of this.pending.values()) {
			this.flying.push({ mesh, from: mesh.position.clone(), to: localTarget.clone(), t: 0 });
		}
		this.pending.clear();
	}

	/** A rejected tx: brief red flash at the pool, then gravity wins. */
	showRejection(): void {
		const mesh = new THREE.Mesh(SPHERE_GEOMETRY, REJECT_MATERIAL.clone());
		mesh.position.copy(POOL_CENTER).add(new THREE.Vector3(0, -0.6, 0.6));
		this.group.add(mesh);
		this.falling.push({
			mesh,
			velocity: new THREE.Vector3((Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2),
			life: 0,
		});
	}

	update(dt: number): void {
		this.elapsed += dt;

		// Idle bobbing — alive, but clearly "waiting".
		for (const { mesh, home, phase } of this.pending.values()) {
			mesh.position.y = home.y + 0.18 * Math.sin(this.elapsed * 2 + phase);
		}

		// Fly-into-block: ease-in quadratic with a slight arc.
		this.flying = this.flying.filter((f) => {
			f.t += dt / 0.7; // 0.7s flight
			if (f.t >= 1) {
				this.group.remove(f.mesh);
				return false;
			}
			const eased = f.t * f.t;
			f.mesh.position.lerpVectors(f.from, f.to, eased);
			f.mesh.position.y += Math.sin(f.t * Math.PI) * 0.8; // arc
			return true;
		});

		// Rejected: pop up, then fall and fade.
		this.falling = this.falling.filter((f) => {
			f.life += dt;
			f.velocity.y -= 9.8 * dt;
			f.mesh.position.addScaledVector(f.velocity, dt);
			const material = f.mesh.material as THREE.MeshStandardMaterial;
			material.opacity = Math.max(0, 1 - f.life / 1.4);
			if (f.life >= 1.4) {
				this.group.remove(f.mesh);
				material.dispose();
				return false;
			}
			return true;
		});
	}
}
