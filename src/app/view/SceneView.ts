import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BlockInfo, TxInfo, ValidationReport } from '../model/ChainModel';
import { BlockMesh, CUBE_SIZE, blockPosition } from './BlockMesh';
import { ChainLinkMesh } from './ChainLinkMesh';
import { MempoolView } from './MempoolView';

/**
 * # SceneView — the V in MVC (3D half)
 *
 * Owns the three.js scene and everything in it. It is intentionally
 * dumb: it has methods like "addBlock" and "showMiningProgress" and it
 * renders whatever it was told — it never decides what is valid, never
 * computes a balance, never touches the Model. The Controller calls in;
 * pointer events (selecting a tx) go out through one callback.
 */
export class SceneView {
	private readonly renderer: THREE.WebGLRenderer;
	private readonly scene = new THREE.Scene();
	private readonly camera: THREE.PerspectiveCamera;
	private readonly controls: OrbitControls;
	private readonly clock = new THREE.Clock();
	private readonly raycaster = new THREE.Raycaster();
	private readonly pointer = new THREE.Vector2(2, 2); // offscreen until first move

	private readonly blocks: BlockMesh[] = [];
	private readonly links: ChainLinkMesh[] = [];
	readonly mempool = new MempoolView();

	private miningGhost: THREE.Mesh | null = null;
	private miningTime = 0;
	private bursts: Array<{ points: THREE.Points; velocities: THREE.Vector3[]; life: number }> = [];

	private readonly tooltip: HTMLDivElement;

	constructor(container: HTMLElement) {
		this.renderer = new THREE.WebGLRenderer({ antialias: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		container.appendChild(this.renderer.domElement);

		this.scene.background = new THREE.Color(0x0b1020);
		this.scene.fog = new THREE.Fog(0x0b1020, 30, 90);

		this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
		this.camera.position.set(-6, 7, 14);

		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.target.set(0, 2, 0);

		// Lighting: soft ambient so nothing is pitch black, one directional
		// "sun" for shape, matching the spec.
		this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
		const sun = new THREE.DirectionalLight(0xffffff, 1.4);
		sun.position.set(6, 14, 8);
		this.scene.add(sun);

		const grid = new THREE.GridHelper(160, 80, 0x2a3a5a, 0x1a2438);
		grid.position.y = 0;
		this.scene.add(grid);

		this.scene.add(this.mempool.group);

		// Tooltip: a DOM element that follows the pointer — crisper and
		// cheaper than rendering text in WebGL.
		this.tooltip = document.createElement('div');
		this.tooltip.className = 'tx-tooltip';
		this.tooltip.style.display = 'none';
		container.appendChild(this.tooltip);

		this.renderer.domElement.addEventListener('pointermove', (e) => this.onPointerMove(e));
		window.addEventListener('resize', () => this.onResize());

		this.renderer.setAnimationLoop(() => this.tick());
	}

	// ── chain display ──────────────────────────────────────────────────

	addBlock(info: BlockInfo, celebrate = false): void {
		const mesh = new BlockMesh(info);
		this.blocks.push(mesh);
		this.scene.add(mesh.group);

		if (info.index > 0) {
			const link = new ChainLinkMesh(blockPosition(info.index - 1), blockPosition(info.index), CUBE_SIZE);
			this.links.push(link);
			this.scene.add(link.object);
		}

		if (celebrate) {
			mesh.celebrate();
			this.spawnBurst(blockPosition(info.index));
		}

		// Follow the tip: drift the orbit target (and mempool anchor) so
		// a growing chain stays in frame.
		const tip = blockPosition(info.index);
		this.controls.target.lerp(new THREE.Vector3(tip.x - 2, 2, 0), 0.6);
		this.mempool.setAnchor(tip.x);
	}

	/** Where the NEXT block will appear — used as the mempool drain target. */
	nextBlockWorldPosition(): THREE.Vector3 {
		return blockPosition(this.blocks.length);
	}

	/** Paint the validation verdict: red cubes for bad hashes, red links for broken pointers. */
	applyValidation(report: ValidationReport): void {
		for (const integrity of report.blocks) {
			const block = this.blocks[integrity.index];
			block?.setTampered(!integrity.hashValid || !integrity.signaturesValid);
			if (integrity.index > 0) {
				// Link i-1 connects block i-1 → i, mirroring linkValid:
				// it breaks when the parent's real hash no longer matches
				// what this block recorded — i.e. downstream of an edit.
				this.links[integrity.index - 1]?.setBroken(!integrity.linkValid);
			}
		}
	}

	// ── mining animation ───────────────────────────────────────────────

	/** A translucent "block under construction" pulses at the next slot. */
	startMining(): void {
		const geometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
		const material = new THREE.MeshStandardMaterial({
			color: 0x7fb4ff,
			transparent: true,
			opacity: 0.35,
			emissive: 0x224488,
		});
		this.miningGhost = new THREE.Mesh(geometry, material);
		this.miningGhost.position.copy(this.nextBlockWorldPosition());
		this.miningTime = 0;
		this.scene.add(this.miningGhost);
	}

	/** Mining finished: drop the ghost, fly the mempool in, add the real block. */
	finishMining(info: BlockInfo): void {
		if (this.miningGhost) {
			this.scene.remove(this.miningGhost);
			this.miningGhost.geometry.dispose();
			(this.miningGhost.material as THREE.Material).dispose();
			this.miningGhost = null;
		}
		this.mempool.drainInto(
			blockPosition(info.index),
			info.transactions.map((tx) => tx.hash),
		);
		this.addBlock(info, true);
	}

	/** Success particle burst — a tiny firework of mined-block satisfaction. */
	private spawnBurst(center: THREE.Vector3): void {
		const count = 90;
		const positions = new Float32Array(count * 3);
		const velocities: THREE.Vector3[] = [];
		for (let i = 0; i < count; i++) {
			positions.set([center.x, center.y, center.z], i * 3);
			velocities.push(
				new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5)
					.normalize()
					.multiplyScalar(3 + Math.random() * 4),
			);
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		const material = new THREE.PointsMaterial({ color: 0xffe28a, size: 0.12, transparent: true });
		const points = new THREE.Points(geometry, material);
		this.scene.add(points);
		this.bursts.push({ points, velocities, life: 0 });
	}

	// ── pointer interaction ────────────────────────────────────────────

	private hoverTargets(): THREE.Mesh[] {
		return [...this.blocks.flatMap((b) => b.txSpheres), ...this.mempool.spheres];
	}

	private pickTx(): TxInfo | null {
		this.raycaster.setFromCamera(this.pointer, this.camera);
		const hit = this.raycaster.intersectObjects(this.hoverTargets(), false)[0];
		return hit ? (hit.object.userData.tx as TxInfo) : null;
	}

	private onPointerMove(event: PointerEvent): void {
		this.pointer.set(
			(event.clientX / window.innerWidth) * 2 - 1,
			-(event.clientY / window.innerHeight) * 2 + 1,
		);
		const tx = this.pickTx();
		if (tx) {
			const sig = tx.coinbase ? 'coinbase' : tx.signatureValid ? 'sig ✔' : 'sig ✘';
			this.tooltip.textContent = `${tx.fromName} → ${tx.toName}: ${tx.amount} | ${tx.hash.slice(0, 10)}… | ${sig}`;
			this.tooltip.style.display = 'block';
			this.tooltip.style.left = `${event.clientX + 14}px`;
			this.tooltip.style.top = `${event.clientY + 14}px`;
		} else {
			this.tooltip.style.display = 'none';
		}
	}

	private onResize(): void {
		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(window.innerWidth, window.innerHeight);
	}

	// ── render loop ────────────────────────────────────────────────────

	private tick(): void {
		const dt = Math.min(this.clock.getDelta(), 0.05); // clamp tab-switch jumps

		for (const block of this.blocks) block.update(dt);
		for (const link of this.links) link.update(dt);
		this.mempool.update(dt);

		if (this.miningGhost) {
			this.miningTime += dt;
			const s = 1 + 0.07 * Math.sin(this.miningTime * 9);
			this.miningGhost.scale.setScalar(s);
			this.miningGhost.rotation.y += dt * 0.8;
		}

		this.bursts = this.bursts.filter((burst) => {
			burst.life += dt;
			const positions = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
			for (let i = 0; i < burst.velocities.length; i++) {
				const v = burst.velocities[i]!;
				v.y -= 6 * dt; // gravity
				positions.setXYZ(
					i,
					positions.getX(i) + v.x * dt,
					positions.getY(i) + v.y * dt,
					positions.getZ(i) + v.z * dt,
				);
			}
			positions.needsUpdate = true;
			(burst.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - burst.life / 1.2);
			if (burst.life >= 1.2) {
				this.scene.remove(burst.points);
				burst.points.geometry.dispose();
				(burst.points.material as THREE.Material).dispose();
				return false;
			}
			return true;
		});

		this.controls.update();
		this.renderer.render(this.scene, this.camera);
	}
}
