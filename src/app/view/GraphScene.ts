import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { ChannelSnapshot } from '../../core/layers/Layer2System';
import { TextSprite } from './animations/TextSprite';
import { makeEdgeMaterial, updateEdgeResolutions } from './edgeMaterials';
import { boosted, prefersReducedMotion, theme } from './theme';
import { Tweens } from './tween';

/**
 * # GraphScene — the Lightning page's stage
 *
 * Deliberately NOT a chain: the foreground is a GRAPH of nodes and
 * channels, because that is what Lightning is. Channels render as
 * two-color bars whose fill ratio IS the balance split — payments
 * visibly slide the split with no block in sight. The Bitcoin L1
 * appears only as a dimmed miniature strip in the background, lighting
 * up exclusively when a settlement lands: that contrast is the whole
 * thesis of the page.
 *
 * Built from the same primitives as SceneView (theme, fat lines,
 * tweens, text sprites) — a sibling, not a fork of chain rendering.
 */

const NODE_W = 0.6;
const NODE_H = 1.3;
const RADIUS = 6.2;
const BAR_THICKNESS = 0.16;
const STRIP_Z = -11;
const STRIP_CUBE = 0.7;

const NODE_GEOMETRY = new THREE.BoxGeometry(NODE_W, NODE_H, NODE_W);
const NODE_EDGES = new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(NODE_GEOMETRY));
const NODE_BODY = new THREE.MeshStandardMaterial({
	color: theme.colors.blockBody,
	roughness: 0.85,
	emissive: theme.colors.blockBody,
	emissiveIntensity: 0.35,
});
const NODE_EDGE_MAT = makeEdgeMaterial(boosted(theme.colors.edge, theme.boost.edges), theme.edgeWidth.block);

/** lightning yellow for side A, violet for side B — the split must pop */
const SIDE_A = new THREE.MeshBasicMaterial({ color: 0xf7c548 });
const SIDE_B = new THREE.MeshBasicMaterial({ color: theme.colors.active });
const BAR_DIM = new THREE.MeshBasicMaterial({ color: theme.colors.border });
const PULSE_MAT = new THREE.MeshBasicMaterial({
	color: boosted(theme.colors.valid, theme.boost.pulse),
	transparent: true,
});
const STRIP_BODY = new THREE.MeshBasicMaterial({ color: theme.colors.blockBody });
const STRIP_EDGE = makeEdgeMaterial(theme.colors.edgeQuiet, 1.5);
const STRIP_EDGE_LIT = makeEdgeMaterial(boosted(0xf7c548, 1.1), 2.0, { transparent: true });
const STRIP_GEOMETRY = new THREE.BoxGeometry(STRIP_CUBE, STRIP_CUBE, STRIP_CUBE);
const STRIP_EDGES = new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(STRIP_GEOMETRY));
const RING_GEOMETRY = new THREE.RingGeometry(0.5, 0.62, 48);

interface NodeView {
	group: THREE.Group;
	position: THREE.Vector3;
}

interface ChannelView {
	group: THREE.Group;
	barA: THREE.Mesh;
	barB: THREE.Mesh;
	label: TextSprite;
	a: string;
	b: string;
	from: THREE.Vector3;
	to: THREE.Vector3;
	length: number;
	disputeRing?: { ring: THREE.Mesh; label: TextSprite };
}

export class GraphScene {
	private readonly renderer: THREE.WebGLRenderer;
	private readonly scene = new THREE.Scene();
	private readonly camera: THREE.OrthographicCamera;
	private readonly controls: OrbitControls;
	private readonly clock = new THREE.Clock();
	readonly tweens = new Tweens();

	private readonly nodes = new Map<string, NodeView>();
	private readonly channels = new Map<string, ChannelView>();
	private readonly stripBlocks: THREE.Group[] = [];

	constructor(container: HTMLElement) {
		this.renderer = new THREE.WebGLRenderer({ antialias: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		container.appendChild(this.renderer.domElement);

		this.scene.background = new THREE.Color(theme.colors.background);
		this.scene.fog = new THREE.Fog(theme.colors.background, theme.fog.near, theme.fog.far);

		const aspect = window.innerWidth / window.innerHeight;
		const halfH = 9;
		this.camera = new THREE.OrthographicCamera(-halfH * aspect, halfH * aspect, halfH, -halfH, 0.1, 300);
		const isoDir = theme.camera.isoDirection.clone().normalize();
		const target = new THREE.Vector3(0, 0.5, -2);
		this.camera.position.copy(target).addScaledVector(isoDir, theme.camera.distance);
		this.camera.lookAt(target);

		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.target.copy(target);
		const isoPolar = Math.acos(isoDir.y);
		this.controls.minPolarAngle = isoPolar - theme.camera.polarSwing;
		this.controls.maxPolarAngle = isoPolar + theme.camera.polarSwing;
		this.controls.minZoom = theme.camera.zoomMin;
		this.controls.maxZoom = theme.camera.zoomMax;

		this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
		const sun = new THREE.DirectionalLight(0xffffff, 0.8);
		sun.position.set(6, 14, 8);
		this.scene.add(sun);
		const grid = new THREE.GridHelper(240, 120, theme.colors.grid, theme.colors.grid);
		this.scene.add(grid);

		const vignette = document.createElement('div');
		vignette.className = 'vignette';
		container.appendChild(vignette);

		window.addEventListener('resize', () => this.onResize());
		updateEdgeResolutions(window.innerWidth, window.innerHeight);
		this.renderer.setAnimationLoop(() => this.tick());
	}

	// ── nodes ──────────────────────────────────────────────────────────

	setNodes(names: readonly string[]): void {
		names.forEach((name, i) => {
			if (this.nodes.has(name)) return;
			const angle = (i / names.length) * Math.PI * 2;
			const position = new THREE.Vector3(Math.cos(angle) * RADIUS, NODE_H / 2, Math.sin(angle) * RADIUS * 0.62);
			const group = new THREE.Group();
			group.position.copy(position);
			group.add(new THREE.Mesh(NODE_GEOMETRY, NODE_BODY));
			group.add(new LineSegments2(NODE_EDGES, NODE_EDGE_MAT));
			const label = new TextSprite(2.2);
			label.set([name]);
			label.sprite.position.y = NODE_H / 2 + 0.55;
			group.add(label.sprite);
			this.scene.add(group);
			this.nodes.set(name, { group, position });
		});
	}

	// ── channels ───────────────────────────────────────────────────────

	/** Create or update a channel bar; the split point tweens smoothly. */
	upsertChannel(snapshot: ChannelSnapshot): void {
		let view = this.channels.get(snapshot.channelId);
		if (!view) {
			const from = this.nodes.get(snapshot.a)?.position;
			const to = this.nodes.get(snapshot.b)?.position;
			if (!from || !to) return;
			const group = new THREE.Group();
			const barA = new THREE.Mesh(new THREE.BoxGeometry(1, BAR_THICKNESS, BAR_THICKNESS), SIDE_A);
			const barB = new THREE.Mesh(new THREE.BoxGeometry(1, BAR_THICKNESS, BAR_THICKNESS), SIDE_B);
			const label = new TextSprite(1.6);
			label.sprite.position.y = 0.42;
			group.add(barA, barB, label.sprite);
			// orient the group along the from→to segment, at pillar height
			const mid = from.clone().add(to).multiplyScalar(0.5);
			mid.y = 0.55;
			group.position.copy(mid);
			group.lookAt(new THREE.Vector3(to.x, 0.55, to.z));
			group.rotateY(Math.PI / 2); // bar geometry extends along local x
			view = {
				group,
				barA,
				barB,
				label,
				a: snapshot.a,
				b: snapshot.b,
				from,
				to,
				length: from.distanceTo(to) - NODE_W * 1.4,
			};
			this.scene.add(group);
			this.channels.set(snapshot.channelId, view);
		}

		const v = view;
		const total = snapshot.balanceA + snapshot.balanceB;
		const ratio = total > 0 ? snapshot.balanceA / total : 0.5;
		const dim = snapshot.status !== 'open';
		v.barA.material = dim ? BAR_DIM : SIDE_A;
		v.barB.material = dim ? BAR_DIM : SIDE_B;
		v.label.set([`#${snapshot.stateNumber} · ${snapshot.balanceA}/${snapshot.balanceB}`]);
		const targetA = v.length * ratio;
		const startA = (v.barA.scale.x as number) || v.length / 2;
		void this.tweens.run(0.45, (t) => {
			const a = startA + (targetA - startA) * t;
			const b = v.length - a;
			v.barA.scale.x = Math.max(a, 0.001);
			v.barB.scale.x = Math.max(b, 0.001);
			v.barA.position.x = -v.length / 2 + a / 2;
			v.barB.position.x = v.length / 2 - b / 2;
		});

		if (snapshot.status === 'closed') {
			// dissolve the edge: the tab is settled, the relationship ended
			void this.tweens.run(0.8, (t) => v.group.scale.setScalar(Math.max(1 - t, 0.001))).finished.then(() => {
				this.scene.remove(v.group);
				v.label.dispose();
				this.channels.delete(snapshot.channelId);
			});
		}
	}

	/** Route preview: brighten the path's channels, dim the rest. */
	highlightPath(path: readonly string[] | null): void {
		for (const view of this.channels.values()) view.group.scale.setScalar(1);
		if (!path) return;
		for (let i = 0; i < path.length - 1; i++) {
			const view = this.channelBetween(path[i]!, path[i + 1]!);
			view?.group.scale.setScalar(1.25);
		}
	}

	// ── payment choreography ───────────────────────────────────────────

	/** A pulse hops node-to-node; HTLC locks appear forward, resolve backward. */
	async animatePayment(path: readonly string[], hopMs: number): Promise<void> {
		if (prefersReducedMotion() || path.length < 2) return;
		const points = path
			.map((name) => this.nodes.get(name)?.position.clone().setY(0.9))
			.filter((p): p is THREE.Vector3 => !!p);

		const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), PULSE_MAT.clone());
		this.scene.add(pulse);
		const locks: TextSprite[] = [];

		for (let i = 0; i < points.length - 1; i++) {
			const from = points[i]!;
			const to = points[i + 1]!;
			await this.tweens.run(Math.max(hopMs, 60) / 1000, (t) => {
				pulse.position.lerpVectors(from, to, t);
			}).finished;
			// the hash-lock appears as the payment moves FORWARD…
			const lock = new TextSprite(0.9);
			lock.set(['🔒']);
			lock.sprite.position.copy(from.clone().add(to).multiplyScalar(0.5)).setY(1.35);
			this.scene.add(lock.sprite);
			locks.push(lock);
		}
		// …and resolves BACKWARD as the preimage propagates
		for (let i = locks.length - 1; i >= 0; i--) {
			await this.tweens.wait(Math.max(hopMs, 60) / 2000);
			const lock = locks[i]!;
			lock.set(['✓']);
			void this.tweens.run(0.5, (t) => (lock.opacity = 1 - t)).finished.then(() => {
				this.scene.remove(lock.sprite);
				lock.dispose();
			});
		}
		void this.tweens.run(0.4, (t) => ((pulse.material as THREE.MeshBasicMaterial).opacity = 1 - t)).finished.then(() => {
			this.scene.remove(pulse);
			(pulse.material as THREE.Material).dispose();
		});
	}

	// ── disputes ───────────────────────────────────────────────────────

	showDispute(channelId: string, blocksLeft: number): void {
		const view = this.channels.get(channelId);
		if (!view) return;
		if (!view.disputeRing) {
			const ring = new THREE.Mesh(
				RING_GEOMETRY,
				new THREE.MeshBasicMaterial({
					color: boosted(theme.colors.invalid, 1.2),
					side: THREE.DoubleSide,
					transparent: true,
				}),
			);
			ring.rotation.x = -Math.PI / 2;
			ring.position.y = 1.6;
			const label = new TextSprite(1.4);
			label.sprite.position.y = 2.1;
			view.group.add(ring, label.sprite);
			view.disputeRing = { ring, label };
		}
		view.disputeRing.label.set([`dispute: ${blocksLeft} blocks`]);
	}

	resolveDispute(channelId: string, outcome: 'justice' | 'cheat-succeeded'): void {
		const view = this.channels.get(channelId);
		if (!view?.disputeRing) return;
		view.disputeRing.label.set([outcome === 'justice' ? '⚖ justice served' : 'cheat succeeded']);
		const { ring, label } = view.disputeRing;
		void this.tweens.run(1.6, (t) => {
			(ring.material as THREE.MeshBasicMaterial).opacity = 1 - t;
			if (t > 0.7) label.opacity = (1 - t) / 0.3;
		}).finished.then(() => {
			view.group.remove(ring, label.sprite);
			label.dispose();
		});
	}

	// ── the background Bitcoin strip ───────────────────────────────────

	/** A new L1 block: a small dim cube slides onto the strip. `lit` when
	 *  it carries a settlement — the only time the background speaks. */
	pushStripBlock(label: string, lit: boolean): void {
		const group = new THREE.Group();
		group.add(new THREE.Mesh(STRIP_GEOMETRY, STRIP_BODY));
		group.add(new LineSegments2(STRIP_EDGES, lit ? STRIP_EDGE_LIT : STRIP_EDGE));
		const text = new TextSprite(1.5);
		text.set([label]);
		text.sprite.position.y = -0.75;
		group.add(text.sprite);
		group.position.set(this.stripBlocks.length === 0 ? 0 : 0 + 1.1, STRIP_CUBE / 2, STRIP_Z);

		// shift the strip left; cap its length
		for (const existing of this.stripBlocks) {
			const targetX = existing.position.x - 1.1;
			void this.tweens.run(0.4, (t) => (existing.position.x = existing.position.x + (targetX - existing.position.x) * t));
		}
		group.position.x = (this.stripBlocks[this.stripBlocks.length - 1]?.position.x ?? -1.1) + 1.1;
		this.scene.add(group);
		this.stripBlocks.push(group);
		if (this.stripBlocks.length > 12) {
			const oldest = this.stripBlocks.shift()!;
			this.scene.remove(oldest);
		}
	}

	/** A settlement tx leaves the graph and drops toward the L1 strip. */
	dropSettlement(fromNode?: string): void {
		if (prefersReducedMotion()) return;
		const start =
			(fromNode ? this.nodes.get(fromNode)?.position.clone() : null) ?? new THREE.Vector3(0, 1, 0);
		start.y = 1.2;
		const cube = new THREE.Mesh(
			new THREE.BoxGeometry(0.3, 0.3, 0.3),
			new THREE.MeshBasicMaterial({ color: boosted(0xf7c548, 1.4), transparent: true }),
		);
		cube.position.copy(start);
		this.scene.add(cube);
		const end = new THREE.Vector3(1.1 + (this.stripBlocks[this.stripBlocks.length - 1]?.position.x ?? 0), 0.6, STRIP_Z);
		void this.tweens.run(1.1, (t) => {
			cube.position.lerpVectors(start, end, t);
			cube.position.y += Math.sin(t * Math.PI) * 1.6;
			(cube.material as THREE.MeshBasicMaterial).opacity = t > 0.85 ? (1 - t) / 0.15 : 1;
		}).finished.then(() => {
			this.scene.remove(cube);
			(cube.material as THREE.Material).dispose();
		});
	}

	// ── internals ──────────────────────────────────────────────────────

	private channelBetween(a: string, b: string): ChannelView | undefined {
		for (const view of this.channels.values()) {
			if ((view.a === a && view.b === b) || (view.a === b && view.b === a)) return view;
		}
		return undefined;
	}

	private onResize(): void {
		const aspect = window.innerWidth / window.innerHeight;
		const halfH = 9;
		this.camera.left = -halfH * aspect;
		this.camera.right = halfH * aspect;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		updateEdgeResolutions(window.innerWidth, window.innerHeight);
	}

	private tick(): void {
		const dt = Math.min(this.clock.getDelta(), 0.05);
		this.tweens.update(dt);
		this.controls.update();
		this.renderer.render(this.scene, this.camera);
	}
}
