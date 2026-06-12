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
import { ConfirmationAnimation } from './animations/ConfirmationAnimation';
import { MiningAnimation } from './animations/MiningAnimation';
import { SigningAnimation } from './animations/SigningAnimation';
import { TamperAnimation } from './animations/TamperAnimation';
import { VerificationAnimation } from './animations/VerificationAnimation';
import { prefersReducedMotion, theme } from './theme';
import { Tweens } from './tween';

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

	// camera auto-follow state
	private interacting = false;
	private lastInteractionEnd = 0;
	private pendingFollowX: number | null = null;
	private followCancel: (() => void) | null = null;

	// validation bookkeeping for diff-based cascade animation
	private brokenLinks = new Set<number>();
	private mismatchedBlocks = new Set<number>();

	// DOM overlays
	private readonly tooltip: HTMLDivElement;
	private readonly pinned: HTMLDivElement;

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
		const target = new THREE.Vector3(2, theme.layout.cubeSize / 2, 0);
		this.camera.position.copy(target).addScaledVector(isoDir, theme.camera.distance);
		this.camera.lookAt(target);

		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.target.copy(target);
		// Constrain to a window around the iso angle: the user can peek,
		// never lose the isometric reading. Zoom = orthographic zoom.
		const isoPolar = Math.acos(isoDir.y); // angle from the +y axis
		const isoAzimuth = Math.atan2(isoDir.x, isoDir.z);
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

		const grid = new THREE.GridHelper(240, 120, theme.colors.grid, theme.colors.grid);
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

		this.tooltip = document.createElement('div');
		this.tooltip.className = 'tooltip-card';
		this.tooltip.style.display = 'none';
		container.appendChild(this.tooltip);

		this.pinned = document.createElement('div');
		this.pinned.className = 'tooltip-card pinned-card';
		this.pinned.style.display = 'none';
		container.appendChild(this.pinned);
		this.pinned.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).dataset.close !== undefined) this.pinned.style.display = 'none';
		});

		this.renderer.domElement.addEventListener('pointermove', (e) => this.onPointerMove(e));
		this.renderer.domElement.addEventListener('click', (e) => this.onClick(e));
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

	/** block:mined — lock readout, shockwave, real block, link, drain, ripple. */
	async finishMining(info: BlockInfo, difficulty: number): Promise<void> {
		if (this.mining) {
			await this.mining.succeed(info.nonce, info.hash, difficulty, this.tweens);
			this.mining.dispose();
			this.mining = null;
		}

		this.addBlock(info);
		const mesh = this.blocks[this.blocks.length - 1]!;
		// pop-in: solidifying out of the ghost
		void this.tweens.run(0.35, (t) => mesh.group.scale.setScalar(0.6 + 0.4 * t), {
			easing: theme.easing.out,
		});

		// the previousHash pointer draws itself in from the parent
		const link = this.links[this.links.length - 1];
		const drawn = link ? link.drawIn(this.tweens) : Promise.resolve();

		// mined transactions fly home with staggered arcs
		const target = blockPosition(info.index).add(new THREE.Vector3(0, theme.layout.cubeSize, 0));
		await Promise.all([
			drawn,
			this.mempool.drainInto(target, info.transactions.map((tx) => tx.hash), this.tweens),
		]);

		// every block below just got one confirmation deeper — ripple it
		void new ConfirmationAnimation(this.blocks, this.tweens).finished;

		this.requestFollow(blockPosition(info.index).x);
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

	setPinnedConfirmations(count: number): void {
		const span = this.pinned.querySelector<HTMLElement>('[data-confirmations]');
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

	private hoverTargets(): THREE.Mesh[] {
		return [
			...this.mempool.hoverTargets,
			...this.blocks.flatMap((b) => [b.body, ...b.txCubes.map((c) => c.body)]),
		];
	}

	private pick(): { tx?: TxInfo; block?: BlockInfo } | null {
		this.raycaster.setFromCamera(this.pointer, this.camera);
		const hit = this.raycaster.intersectObjects(this.hoverTargets(), false)[0];
		if (!hit) return null;
		const { tx, block } = hit.object.userData as { tx?: TxInfo; block?: BlockInfo };
		return tx ? { tx } : block ? { block } : null;
	}

	private cardHtml(picked: { tx?: TxInfo; block?: BlockInfo }): string {
		if (picked.tx) {
			const tx = picked.tx;
			const sig = tx.coinbase
				? '<span class="muted">coinbase — minted, no signature</span>'
				: tx.signatureValid
					? '<span class="ok">signature verified</span>'
					: '<span class="bad">signature invalid</span>';
			return (
				`<div class="card-title">${tx.fromName} → ${tx.toName}</div>` +
				`<div class="card-amount">${tx.amount}</div>` +
				`<div class="mono muted">${shortHash(tx.hash)}</div>` +
				`<div>${sig}</div>`
			);
		}
		const block = picked.block!;
		return (
			`<div class="card-title">${block.index === 0 ? 'genesis block' : `block #${block.index}`}</div>` +
			`<div class="mono muted">${shortHash(block.hash)}</div>` +
			`<div class="muted">nonce <span class="mono">${block.nonce.toLocaleString('en-US')}</span> · ${block.transactions.length} tx</div>`
		);
	}

	private onPointerMove(event: PointerEvent): void {
		this.pointer.set(
			(event.clientX / window.innerWidth) * 2 - 1,
			-(event.clientY / window.innerHeight) * 2 + 1,
		);
		const picked = this.pick();
		if (picked) {
			this.tooltip.innerHTML = this.cardHtml(picked);
			this.tooltip.style.display = 'block';
			this.tooltip.style.left = `${event.clientX + 14}px`;
			this.tooltip.style.top = `${event.clientY + 14}px`;
		} else {
			this.tooltip.style.display = 'none';
		}
	}

	/** Clicking a cube pins its card (with live confirmations for a tx). */
	private onClick(event: MouseEvent): void {
		const picked = this.pick();
		if (!picked) return;
		const confirmations = picked.tx
			? `<div class="muted">confirmations <span class="mono" data-confirmations>0</span></div>`
			: '';
		this.pinned.innerHTML =
			`<button class="card-close" data-close aria-label="close">×</button>` +
			this.cardHtml(picked) +
			confirmations;
		this.pinned.style.display = 'block';
		this.pinned.style.left = `${Math.min(event.clientX + 14, window.innerWidth - 240)}px`;
		this.pinned.style.top = `${Math.min(event.clientY + 14, window.innerHeight - 160)}px`;
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
		this.composer.render();
	}
}
