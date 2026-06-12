import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import type { BlockInfo, TxInfo, ValidationReport } from '../model/ChainModel';
import { BlockMesh, EDGE_LATEST, blockPosition, shortHash } from './BlockMesh';
import { ChainLinkMesh, EnergyPulse } from './ChainLinkMesh';
import { MempoolView } from './MempoolView';
import { TxCubeMesh } from './TxCubeMesh';
import { updateEdgeResolutions } from './edgeMaterials';
import { compensateLabelZoom } from './labels';
import { ConfirmationAnimation } from './animations/ConfirmationAnimation';
import { TextSprite } from './animations/TextSprite';
import { MiningAnimation } from './animations/MiningAnimation';
import { SigningAnimation } from './animations/SigningAnimation';
import { TamperAnimation } from './animations/TamperAnimation';
import { VerificationAnimation } from './animations/VerificationAnimation';
import { cssColor, prefersReducedMotion, theme } from './theme';
import { Tweens } from './tween';

/**
 * The in-scene half of a callout: the anchor dot and the leader line
 * live in the 3D world (depth-tested), so the hovered cube occludes
 * them — the line visibly starts BEHIND the object instead of being
 * painted over it like a DOM overlay must. The line lies in the screen
 * plane through the anchor and uses the same pixel offsets as the DOM
 * card, so the two halves always meet at the card dot.
 */
const LEADER_DOT_GEOMETRY = new THREE.SphereGeometry(0.5, 12, 8);

class LeaderLine3D {
	private readonly line: THREE.Line;
	private readonly dot: THREE.Mesh;
	private readonly positions = new Float32Array(6);

	constructor(scene: THREE.Scene) {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
		this.line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffffff }));
		this.dot = new THREE.Mesh(LEADER_DOT_GEOMETRY, new THREE.MeshBasicMaterial({ color: 0xffffff }));
		this.line.frustumCulled = false; // endpoints move every frame
		this.line.visible = false;
		this.dot.visible = false;
		scene.add(this.line, this.dot);
	}

	update(anchor: THREE.Vector3, dir: 'tr' | 'bl', camera: THREE.OrthographicCamera): void {
		// px → world: the ortho frustum spans viewHeight/zoom world units
		// over the viewport height
		const worldPerPx = theme.camera.viewHeight / camera.zoom / window.innerHeight;
		const rad = (theme.callout.angleDeg * Math.PI) / 180;
		const dxPx = theme.callout.liftPx * Math.sin(rad) * (dir === 'tr' ? 1 : -1);
		const dyPx = theme.callout.liftPx * Math.cos(rad) * (dir === 'tr' ? 1 : -1); // screen-up
		const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
		const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
		const end = anchor
			.clone()
			.addScaledVector(right, dxPx * worldPerPx)
			.addScaledVector(up, dyPx * worldPerPx);

		this.positions.set([anchor.x, anchor.y, anchor.z, end.x, end.y, end.z]);
		(this.line.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
		this.dot.position.copy(anchor);
		this.dot.scale.setScalar(theme.callout.dotPx * worldPerPx);
		this.line.visible = true;
		this.dot.visible = true;
	}

	hide(): void {
		this.line.visible = false;
		this.dot.visible = false;
	}
}

/**
 * # SceneView — the V in MVC (3D half)
 *
 * Owns the three.js world: an orthographic isometric camera (cubes read
 * as clean three-faced diamonds), restrained bloom over an edge-lit
 * monochrome scene, and the choreography that turns Model events into
 * the named animations in ./animations.
 *
 * Still deliberately dumb: it renders what it is told and never decides
 * what is valid. The only outward signal is the pinned-tooltip callback.
 */
export class SceneView {
	/** Controller hook: a tx card was pinned; reply via setPinnedConfirmations. */
	onTxPinned: ((tx: TxInfo) => void) | null = null;

	private readonly renderer: THREE.WebGLRenderer;
	private readonly scene = new THREE.Scene();
	private readonly camera: THREE.OrthographicCamera;
	private readonly controls: OrbitControls;
	private readonly composer: EffectComposer;
	private readonly fxaaPass: ShaderPass;
	private readonly clock = new THREE.Clock();
	private readonly raycaster = new THREE.Raycaster();
	private readonly pointer = new THREE.Vector2(2, 2);
	private readonly tweens = new Tweens();

	private readonly blocks: BlockMesh[] = [];
	private readonly links: ChainLinkMesh[] = [];
	private readonly pulse = new EnergyPulse();
	readonly mempool = new MempoolView();

	private mining: MiningAnimation | null = null;
	private breatheTime = 0;
	/** post-processing on/off — the "magic shader" switch. Off by
	 *  default (must match the Hud button's initial state): bloom taxes
	 *  the GPU every frame, so the glow is opt-in. */
	private postProcessing = false;

	// camera auto-follow state
	private interacting = false;
	private lastInteractionEnd = 0;
	private pendingFollowX: number | null = null;
	private followCancel: (() => void) | null = null;

	// validation bookkeeping for diff-based cascade animation
	private brokenLinks = new Set<number>();
	private mismatchedBlocks = new Set<number>();

	// Callout dialogs: anchor dot + leader live IN the scene (LeaderLine3D,
	// occluded by geometry); the card + its dot are DOM overlays.
	private readonly hover: { root: HTMLDivElement; card: HTMLDivElement };
	private readonly pinned: { root: HTMLDivElement; card: HTMLDivElement };
	private readonly hoverLeader: LeaderLine3D;
	private readonly pinnedLeader: LeaderLine3D;
	private hoverKey: string | null = null;
	private pinnedTarget: THREE.Object3D | null = null;
	private pinnedLift = 0;
	private pinnedPrefer: 'tr' | 'bl' = 'bl';
	private readonly projVec = new THREE.Vector3();

	constructor(container: HTMLElement) {
		this.renderer = new THREE.WebGLRenderer({ antialias: false }); // FXAA pass instead
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		container.appendChild(this.renderer.domElement);

		this.scene.background = new THREE.Color(theme.colors.background);
		// Fog fades the floor grid (and old history) out with distance —
		// ranges are camera-relative, see the note on theme.fog.
		this.scene.fog = new THREE.Fog(theme.colors.background, theme.fog.near, theme.fog.far);

		// ── orthographic isometric camera ──
		const aspect = window.innerWidth / window.innerHeight;
		const halfH = theme.camera.viewHeight / 2;
		this.camera = new THREE.OrthographicCamera(-halfH * aspect, halfH * aspect, halfH, -halfH, 0.1, 300);
		const isoDir = theme.camera.isoDirection.clone().normalize();
		const isoPolar = Math.acos(isoDir.y); // angle from the +y axis
		const isoAzimuth = Math.atan2(isoDir.x, isoDir.z);
		const target = new THREE.Vector3(2, theme.layout.cubeSize / 2, 0);
		// Start at the MOST top-down inclination the constraints allow
		// (iso polar minus the full swing) — the user can still tilt
		// down toward the horizon within the swing window.
		const startDir = new THREE.Vector3().setFromSphericalCoords(
			1,
			isoPolar - theme.camera.polarSwing,
			isoAzimuth,
		);
		this.camera.position.copy(target).addScaledVector(startDir, theme.camera.distance);
		this.camera.lookAt(target);

		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.target.copy(target);
		// Constrain to a window around the iso angle: the user can peek,
		// never lose the isometric reading. Zoom = orthographic zoom.
		this.controls.minPolarAngle = isoPolar - theme.camera.polarSwing;
		this.controls.maxPolarAngle = isoPolar + theme.camera.polarSwing;
		this.controls.minAzimuthAngle = isoAzimuth - theme.camera.azimuthSwing;
		this.controls.maxAzimuthAngle = isoAzimuth + theme.camera.azimuthSwing;
		this.controls.minZoom = theme.camera.zoomMin;
		this.controls.maxZoom = theme.camera.zoomMax;
		this.controls.addEventListener('start', () => {
			this.interacting = true;
			this.followCancel?.(); // never fight the user
		});
		this.controls.addEventListener('end', () => {
			this.interacting = false;
			this.lastInteractionEnd = performance.now();
		});

		// Soft ambient + one directional: just enough shape for the
		// near-black bodies; the edges carry the look.
		this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
		const sun = new THREE.DirectionalLight(0xffffff, 0.8);
		sun.position.set(6, 14, 8);
		this.scene.add(sun);

		// Grid cell = half the block spacing, so every block center lands
		// on the same spot of its cell; the half-cell offset then centers
		// each cube INSIDE a cell instead of straddling a line.
		const cell = theme.layout.blockSpacing / 2;
		const gridDivisions = 120;
		const grid = new THREE.GridHelper(gridDivisions * cell, gridDivisions, theme.colors.grid, theme.colors.grid);
		grid.position.set(cell / 2, 0, cell / 2);
		this.scene.add(grid);
		this.scene.add(this.mempool.group);
		this.scene.add(this.pulse.mesh);

		// ── post-processing: restrained bloom + FXAA ──
		this.composer = new EffectComposer(this.renderer);
		this.composer.addPass(new RenderPass(this.scene, this.camera));
		this.composer.addPass(
			new UnrealBloomPass(
				new THREE.Vector2(window.innerWidth, window.innerHeight),
				theme.bloom.strength,
				theme.bloom.radius,
				theme.bloom.threshold,
			),
		);
		this.composer.addPass(new OutputPass());
		this.fxaaPass = new ShaderPass(FXAAShader);
		this.composer.addPass(this.fxaaPass);
		this.setFxaaResolution();
		updateEdgeResolutions(window.innerWidth, window.innerHeight);

		// ── DOM overlays: vignette, hover tooltip, pinned card ──
		const vignette = document.createElement('div');
		vignette.className = 'vignette';
		container.appendChild(vignette);

		this.hover = SceneView.buildCallout('');
		this.pinned = SceneView.buildCallout('pinned');
		this.hoverLeader = new LeaderLine3D(this.scene);
		this.pinnedLeader = new LeaderLine3D(this.scene);
		container.append(this.hover.root, this.pinned.root);
		this.pinned.root.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).dataset.close !== undefined) this.closePinned();
		});

		this.renderer.domElement.addEventListener('pointermove', (e) => {
			this.pointer.set(
				(e.clientX / window.innerWidth) * 2 - 1,
				-(e.clientY / window.innerHeight) * 2 + 1,
			);
		});
		// leaving the canvas (e.g. onto a HUD panel) must drop the hover
		this.renderer.domElement.addEventListener('pointerleave', () => this.pointer.set(2, 2));
		this.renderer.domElement.addEventListener('click', () => this.onClick());
		window.addEventListener('resize', () => this.onResize());

		this.renderer.setAnimationLoop(() => this.tick());
	}

	// ── chain display ──────────────────────────────────────────────────

	/** Add a block without ceremony (genesis / initial state). */
	addBlock(info: BlockInfo): void {
		const mesh = new BlockMesh(info);
		this.blocks.push(mesh);
		this.scene.add(mesh.group);
		if (info.index > 0) {
			const link = new ChainLinkMesh(info.index);
			this.links.push(link);
			this.scene.add(link.object);
		}
		this.setLatest(info.index);
		this.mempool.setAnchor(blockPosition(info.index).x);
	}

	private setLatest(index: number): void {
		for (const block of this.blocks) block.setLatest(block.index === index);
	}

	// ── transaction choreography ───────────────────────────────────────

	/**
	 * tx:added — the full intro: cube materializes at the staging spot,
	 * the private key signs it, the scan plane verifies it, and it
	 * settles into the mempool grid.
	 */
	async showIncomingTx(tx: TxInfo): Promise<void> {
		const cube = new TxCubeMesh(tx);
		this.mempool.enter(tx, cube);
		await new SigningAnimation(cube, tx.hash, this.tweens).finished;
		await new VerificationAnimation(cube, 'valid', this.tweens).finished;
		await this.mempool.settle(tx.hash, this.tweens);
	}

	/**
	 * tx:rejected — same story with the sad ending: signed (signatures
	 * are usually fine!), scanned, refused, tumbled off-screen. The
	 * ticker explains which check failed.
	 */
	async showRejectedTx(): Promise<void> {
		const cube = new TxCubeMesh(null);
		cube.group.position.copy(this.mempool.stagingWorldPosition());
		this.scene.add(cube.group);
		await new SigningAnimation(cube, 'deadbeef00', this.tweens).finished;
		await new VerificationAnimation(cube, 'invalid', this.tweens).finished;
		this.scene.remove(cube.group);
	}

	// ── mining choreography ────────────────────────────────────────────

	startMining(blockIndex: number): void {
		this.mining?.dispose();
		this.mining = new MiningAnimation(blockIndex, this.scene);
	}

	updateMiningReadout(nonce: number, hashAttempt: string): void {
		this.mining?.updateReadout(nonce, hashAttempt);
	}

	/** block:mined — ONE continuous moment: the readout locks and in the
	 *  same frame the real block starts growing inside the dissolving
	 *  ghost; the shockwave rolls out a beat later under the now-solid
	 *  cube; the link draws and the mempool drains alongside. No pauses
	 *  between phases — a stall followed by simultaneous effects is what
	 *  reads as a glitchy pop. */
	async finishMining(info: BlockInfo, difficulty: number): Promise<void> {
		let ghost: MiningAnimation | null = null;
		if (this.mining) {
			this.mining.lockReadout(info.nonce, info.hash, difficulty);
			ghost = this.mining;
			this.mining = null;
		}

		this.addBlock(info);
		const mesh = this.blocks[this.blocks.length - 1]!;
		// Materialize: scale to ~0 SYNCHRONOUSLY (before this frame
		// renders — a tween's first update only lands next frame, which
		// used to flash the block at full size for one frame), then grow.
		mesh.group.scale.setScalar(0.0001);
		const grown = this.tweens.run(
			theme.timing.blockGrow,
			(t) => mesh.group.scale.setScalar(Math.max(t, 0.0001)),
			{ easing: theme.easing.out },
		).finished;

		// touchdown effects: the ghost shell dissolves around the growing
		// block (its readout lingers, then fades) and the shockwave rolls
		// out underneath once the cube is solid
		if (ghost) {
			const dying = ghost;
			void dying.dissolve(this.tweens).then(() => dying.dispose());
			void dying.playShockwave(this.tweens);
		}

		// the previousHash pointer draws itself in from the parent
		const link = this.links[this.links.length - 1];
		const drawn = link ? link.drawIn(this.tweens) : Promise.resolve();

		// mined transactions fly home with staggered arcs, landing at the
		// floor pad beside the block (where BlockMesh placed their twins)
		const target = blockPosition(info.index).add(
			new THREE.Vector3(
				0,
				-(theme.layout.cubeSize / 2) + theme.layout.txCubeSize / 2,
				theme.layout.cubeSize / 2 + theme.layout.txPadGap + theme.layout.txPadSpacing / 2,
			),
		);
		await Promise.all([
			grown,
			drawn,
			this.mempool.drainInto(target, info.transactions.map((tx) => tx.hash), this.tweens),
		]);

		// every block below just got one confirmation deeper — ripple it
		void new ConfirmationAnimation(this.blocks, this.tweens).finished;

		this.requestFollow(blockPosition(info.index).x);
	}

	/**
	 * A `+N → miner` reward float rising off a freshly mined block — the
	 * little paycheck moment that explains WHY anyone mines at all.
	 */
	celebrateReward(blockIndex: number, text: string): void {
		const label = new TextSprite(3.2);
		label.set([text], { color: cssColor(theme.colors.valid) });
		const base = blockPosition(blockIndex);
		label.sprite.position.set(base.x, base.y + theme.layout.cubeSize, base.z);
		this.scene.add(label.sprite);
		void this.tweens
			.run(1.6, (t) => {
				label.sprite.position.y = base.y + theme.layout.cubeSize + t * 1.4;
				label.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
			})
			.finished.then(() => {
				this.scene.remove(label.sprite);
				label.dispose();
			});
	}

	// ── validation / tamper display ────────────────────────────────────

	/**
	 * Paint a validation report. New damage animates: the tampered block
	 * glitches, then each downstream link snaps red one after another —
	 * invalidity flowing forward through the chain. Repaired state (or
	 * idle re-validation) applies instantly.
	 */
	applyValidation(report: ValidationReport): void {
		// blocks whose stored hash no longer matches their contents
		for (const integrity of report.blocks) {
			const block = this.blocks[integrity.index];
			if (!block) continue;
			const mismatched = !integrity.hashValid || !integrity.signaturesValid;
			if (mismatched && !this.mismatchedBlocks.has(integrity.index)) {
				this.mismatchedBlocks.add(integrity.index);
				void new TamperAnimation(block, this.tweens).finished;
			} else if (!mismatched && this.mismatchedBlocks.delete(integrity.index)) {
				block.restoreLabel();
			}
		}

		// links, with the staggered downstream cascade for new breaks
		const newlyBroken: number[] = [];
		for (const integrity of report.blocks) {
			if (integrity.index === 0) continue;
			const linkIndex = integrity.index - 1;
			const broken = !integrity.linkValid;
			if (broken && !this.brokenLinks.has(linkIndex)) {
				this.brokenLinks.add(linkIndex);
				newlyBroken.push(linkIndex);
			} else if (!broken && this.brokenLinks.delete(linkIndex)) {
				this.links[linkIndex]?.setBroken(false);
				this.blocks[linkIndex + 1]?.setDimmed(false);
			}
		}
		newlyBroken.sort((a, b) => a - b);
		newlyBroken.forEach((linkIndex, order) => {
			let fired = false;
			void this.tweens.run(
				0.05,
				() => {
					if (fired) return;
					fired = true;
					this.links[linkIndex]?.setBroken(true);
					// everything downstream of the first break dims
					for (let b = linkIndex + 1; b < this.blocks.length; b++) {
						this.blocks[b]?.setDimmed(true);
					}
				},
				{ delaySec: (order * theme.timing.cascadeStaggerMs) / 1000 },
			);
		});
	}

	// ── pinned card (controller pushes live confirmations here) ────────

	/**
	 * The "magic shader" switch. Bloom is the GPU hog here — it runs a
	 * chain of blur passes at several resolutions every frame — so when
	 * off we skip the whole composer and render straight to the canvas.
	 * Costs: no glow halos, no FXAA (slightly rougher edges), and HDR-
	 * boosted colors simply clamp. Buys: a much cooler laptop.
	 */
	setPostProcessing(enabled: boolean): void {
		this.postProcessing = enabled;
	}

	setPinnedConfirmations(count: number): void {
		const span = this.pinned.card.querySelector<HTMLElement>('[data-confirmations]');
		if (!span) return;
		if (span.textContent !== String(count)) {
			span.textContent = String(count);
			// odometer tick: re-trigger the CSS animation
			span.classList.remove('odometer-tick');
			void span.offsetWidth;
			span.classList.add('odometer-tick');
		}
	}

	// ── camera auto-follow ─────────────────────────────────────────────

	/** Frame the new tip — but never fight the user (3s idle rule). */
	private requestFollow(tipX: number): void {
		this.pendingFollowX = tipX;
	}

	private maybeFollow(): void {
		if (this.pendingFollowX === null || this.interacting) return;
		if (performance.now() - this.lastInteractionEnd < theme.camera.followIdleMs && this.lastInteractionEnd > 0) return;

		const tipX = this.pendingFollowX;
		this.pendingFollowX = null;
		const fromTarget = this.controls.target.clone();
		const fromCamera = this.camera.position.clone();
		const dx = tipX - 2 - fromTarget.x;
		const handle = this.tweens.run(
			theme.camera.followDuration,
			(t) => {
				this.controls.target.x = fromTarget.x + dx * t;
				this.camera.position.x = fromCamera.x + dx * t;
			},
			{ easing: theme.easing.inOut },
		);
		this.followCancel = () => handle.cancel();
	}

	// ── pointer interaction ────────────────────────────────────────────

	/** The DOM half of a callout: card dot + card. (The anchor dot and
	 *  the leader line are 3D — see LeaderLine3D — so geometry can
	 *  occlude them.) Built once per dialog, repositioned per frame. */
	private static buildCallout(extraClass: string): { root: HTMLDivElement; card: HTMLDivElement } {
		const root = document.createElement('div');
		root.className = `callout ${extraClass}`;
		root.style.display = 'none';
		root.innerHTML =
			`<span class="callout-dot callout-dot-card"></span>` + `<div class="callout-card"></div>`;
		return { root, card: root.querySelector('.callout-card')! };
	}

	private hoverTargets(): THREE.Mesh[] {
		return [
			...this.mempool.hoverTargets,
			...this.blocks.flatMap((b) => [b.body, ...b.txCubes.map((c) => c.body)]),
		];
	}

	private pick(): { object: THREE.Object3D; tx?: TxInfo; block?: BlockInfo } | null {
		this.raycaster.setFromCamera(this.pointer, this.camera);
		const hit = this.raycaster.intersectObjects(this.hoverTargets(), false)[0];
		if (!hit) return null;
		const { tx, block } = hit.object.userData as { tx?: TxInfo; block?: BlockInfo };
		return tx ? { object: hit.object, tx } : block ? { object: hit.object, block } : null;
	}

	/**
	 * Per-type callout anchoring: both annotate toward the bottom-left —
	 * blocks from their BASE, transactions from their CENTER (the anchor
	 * dot sits inside the cube, so the depth-tested leader visibly
	 * emerges from the cube's surface). Either falls back to the
	 * up-right diagonal at screen edges.
	 */
	private static calloutFor(picked: { tx?: TxInfo }): { lift: number; prefer: 'tr' | 'bl' } {
		return picked.tx
			? { lift: 0, prefer: 'bl' }
			: { lift: -theme.layout.cubeSize / 2, prefer: 'bl' };
	}

	/** the callout's world-space anchor point (object center + lift) */
	private static anchorWorld(object: THREE.Object3D, worldLiftY: number): THREE.Vector3 {
		const anchor = object.getWorldPosition(new THREE.Vector3());
		anchor.y += worldLiftY;
		return anchor;
	}

	/** project a world point to CSS pixel coordinates */
	private projectToScreen(point: THREE.Vector3): { x: number; y: number } {
		this.projVec.copy(point).project(this.camera);
		return {
			x: ((this.projVec.x + 1) / 2) * window.innerWidth,
			y: ((1 - this.projVec.y) / 2) * window.innerHeight,
		};
	}

	/**
	 * Place a callout: the root sits ON the anchor point (where the
	 * first dot lives); the leader runs 45° to the card in the preferred
	 * diagonal — top-right or bottom-left — falling back to the other
	 * one when the card would leave the screen. The card may also slide
	 * sideways as a last resort; the dots and line stay glued to the
	 * anchor.
	 */
	private positionCallout(
		callout: { root: HTMLDivElement; card: HTMLDivElement },
		x: number,
		y: number,
		prefer: 'tr' | 'bl',
	): 'tr' | 'bl' {
		// x/y components of the inclined leader (angleDeg away from vertical)
		const rad = (theme.callout.angleDeg * Math.PI) / 180;
		const runX = theme.callout.liftPx * Math.sin(rad);
		const runY = theme.callout.liftPx * Math.cos(rad);
		const w = callout.card.offsetWidth;
		const h = callout.card.offsetHeight;
		const m = 8; // screen margin

		const fitsTr = y - runY - 6 - h >= m && x + runX + 6 + w <= window.innerWidth - m;
		const fitsBl = x - runX - 6 - w >= m && y + runY + 6 + h <= window.innerHeight - m;
		const dir =
			prefer === 'tr' ? (fitsTr ? 'tr' : fitsBl ? 'bl' : 'tr') : fitsBl ? 'bl' : fitsTr ? 'tr' : 'bl';

		callout.root.classList.toggle('callout--tr', dir === 'tr');
		callout.root.classList.toggle('callout--bl', dir === 'bl');
		callout.root.style.left = `${x}px`;
		callout.root.style.top = `${y}px`;

		// horizontal clamp: slide only the card, never the leader
		let shift = 0;
		if (dir === 'tr') {
			const cardLeft = x + runX + 6;
			shift = Math.min(0, window.innerWidth - m - (cardLeft + w));
		} else {
			const cardLeft = x - runX - 6 - w;
			shift = Math.max(0, m - cardLeft);
		}
		callout.card.style.marginLeft = `${shift}px`;
		return dir;
	}

	/** hover dialog, frame-synced: re-picked and re-anchored every tick
	 *  so it stays glued to the object even while the camera pans */
	private updateHoverCallout(): void {
		const picked = this.pick();
		if (!picked) {
			this.hover.root.style.display = 'none';
			this.hoverLeader.hide();
			this.hoverKey = null;
			return;
		}
		const key = picked.tx?.hash ?? picked.block?.hash ?? '';
		if (key !== this.hoverKey) {
			// only rebuild the card when the hovered object changes —
			// rewriting innerHTML every frame would thrash layout
			this.hoverKey = key;
			this.hover.card.innerHTML = this.cardHtml(picked);
		}
		this.hover.root.style.display = 'block';
		const { lift, prefer } = SceneView.calloutFor(picked);
		const anchorWorld = SceneView.anchorWorld(picked.object, lift);
		const screen = this.projectToScreen(anchorWorld);
		const dir = this.positionCallout(this.hover, screen.x, screen.y, prefer);
		this.hoverLeader.update(anchorWorld, dir, this.camera);
	}

	private updatePinnedCallout(): void {
		if (!this.pinnedTarget) return;
		// the target may have left the scene (a pool cube mined away)
		let rootAncestor: THREE.Object3D = this.pinnedTarget;
		while (rootAncestor.parent) rootAncestor = rootAncestor.parent;
		if (rootAncestor !== this.scene) {
			this.closePinned();
			return;
		}
		const anchorWorld = SceneView.anchorWorld(this.pinnedTarget, this.pinnedLift);
		const screen = this.projectToScreen(anchorWorld);
		const dir = this.positionCallout(this.pinned, screen.x, screen.y, this.pinnedPrefer);
		this.pinnedLeader.update(anchorWorld, dir, this.camera);
	}

	private closePinned(): void {
		this.pinned.root.style.display = 'none';
		this.pinnedLeader.hide();
		this.pinnedTarget = null;
	}

	private cardHtml(picked: { tx?: TxInfo; block?: BlockInfo }): string {
		if (picked.tx) {
			const tx = picked.tx;
			const sig = tx.coinbase
				? '<span class="muted">coinbase — minted by the protocol, no signature</span>'
				: tx.signatureValid
					? '<span class="ok">signature verified</span>'
					: '<span class="bad">signature invalid</span>';
			const fee = tx.coinbase
				? `<div class="muted">block reward + collected fees</div>`
				: `<div class="muted">fee <span class="mono">${tx.fee}</span> → goes to the miner</div>`;
			return (
				`<div class="card-title">${tx.fromName} → ${tx.toName}</div>` +
				`<div class="card-amount">${tx.amount}</div>` +
				fee +
				`<div class="mono muted">${shortHash(tx.hash)}</div>` +
				`<div>${sig}</div>`
			);
		}
		const block = picked.block!;
		const coinbase = block.transactions.find((tx) => tx.coinbase);
		const reward = coinbase
			? `<div class="muted">paid <span class="mono">${coinbase.amount}</span> to ${coinbase.toName}</div>`
			: '';
		return (
			`<div class="card-title">${block.index === 0 ? 'genesis block' : `block #${block.index}`}</div>` +
			`<div class="mono muted">${shortHash(block.hash)}</div>` +
			`<div class="muted">nonce <span class="mono">${block.nonce.toLocaleString('en-US')}</span> · ${block.transactions.length} tx</div>` +
			reward
		);
	}

	/** Clicking a cube pins its callout (with live confirmations for a tx).
	 *  The pinned card keeps tracking its object across camera moves. */
	private onClick(): void {
		const picked = this.pick();
		if (!picked) return;
		const confirmations = picked.tx
			? `<div class="muted">confirmations <span class="mono" data-confirmations>0</span></div>`
			: '';
		this.pinned.card.innerHTML =
			`<button class="card-close" data-close aria-label="close">×</button>` +
			this.cardHtml(picked) +
			confirmations;
		this.pinnedTarget = picked.object;
		const { lift, prefer } = SceneView.calloutFor(picked);
		this.pinnedLift = lift;
		this.pinnedPrefer = prefer;
		this.pinned.root.style.display = 'block';
		this.updatePinnedCallout();
		if (picked.tx) this.onTxPinned?.(picked.tx);
	}

	private onResize(): void {
		const aspect = window.innerWidth / window.innerHeight;
		const halfH = theme.camera.viewHeight / 2;
		this.camera.left = -halfH * aspect;
		this.camera.right = halfH * aspect;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.composer.setSize(window.innerWidth, window.innerHeight);
		this.setFxaaResolution();
		updateEdgeResolutions(window.innerWidth, window.innerHeight);
	}

	private setFxaaResolution(): void {
		const pr = this.renderer.getPixelRatio();
		const resolution = this.fxaaPass.material.uniforms['resolution']!.value as THREE.Vector2;
		resolution.set(1 / (window.innerWidth * pr), 1 / (window.innerHeight * pr));
	}

	// ── render loop ────────────────────────────────────────────────────

	private tick(): void {
		const dt = Math.min(this.clock.getDelta(), 0.05);

		this.tweens.update(dt);
		this.mempool.update(dt);
		this.mining?.update(dt);

		// the latest block's slow breathing pulse (shared material)
		if (!prefersReducedMotion()) {
			this.breatheTime += dt;
			EDGE_LATEST.opacity = 0.7 + 0.3 * Math.sin((this.breatheTime * Math.PI * 2) / theme.timing.breathePeriod);
		}

		// the traveling energy pulse dies at the first broken link
		const firstBroken = [...this.brokenLinks].sort((a, b) => a - b)[0];
		const breakX = firstBroken === undefined ? null : blockPosition(firstBroken).x + theme.layout.cubeSize / 2;
		this.pulse.update(dt, blockPosition(this.blocks.length - 1).x, breakX);

		this.maybeFollow();
		this.controls.update();

		// labels stay screen-constant: dezooming grows them in world units
		compensateLabelZoom(this.camera.zoom);

		// callouts last, so they track this frame's camera, not the previous one's
		this.updateHoverCallout();
		this.updatePinnedCallout();

		if (this.postProcessing) {
			this.composer.render();
		} else {
			this.renderer.render(this.scene, this.camera);
		}
	}
}
