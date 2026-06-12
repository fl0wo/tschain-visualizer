import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { BlockInfo } from '../model/ChainModel';
import { TxCubeMesh } from './TxCubeMesh';
import { makeEdgeMaterial } from './edgeMaterials';
import { registerLabel } from './labels';
import { boosted, cssColor, theme } from './theme';

/**
 * The block is the core of the edge-lit aesthetic: a near-background
 * body so the geometry recedes, and a bright wireframe of its edges so
 * the form reads as a crisp isometric diamond. State lives entirely in
 * the edge color, by palette ROLE — `valid` = settled/confirmed,
 * `edge` = genesis (the one block that was agreed, not mined),
 * `active` (breathing) = latest, `invalidDim` = downstream of a break.
 *
 * Settled blocks hold a STABLE valid color: the confirmation ripple
 * only brightens that same hue (see ConfirmationAnimation), it never
 * swaps to a different color — color swaps read as glitches.
 *
 * Geometry and the state materials are module-level singletons shared by
 * every block; only the label canvas is per-instance.
 */

const SIZE = theme.layout.cubeSize;
const CUBE_GEOMETRY = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
/** fat-line version of the cube's 12 edges, shared by every block */
export const CUBE_EDGES = new LineSegmentsGeometry().fromEdgesGeometry(
	new THREE.EdgesGeometry(CUBE_GEOMETRY),
);

const BODY_MATERIAL = new THREE.MeshStandardMaterial({
	color: theme.colors.blockBody,
	roughness: 0.85,
	metalness: 0.1,
	emissive: theme.colors.blockBody,
	emissiveIntensity: 0.35,
});

const WIDTH = theme.edgeWidth.block;
/** settled mined blocks: stable teal — confirmed history, the "valid" accent */
const EDGE_NORMAL = makeEdgeMaterial(boosted(theme.colors.valid, theme.boost.edges), WIDTH);
/** genesis: neutral white — agreed upon, not mined, outside the teal economy */
const EDGE_GENESIS = makeEdgeMaterial(boosted(theme.colors.edge, theme.boost.edges), WIDTH);
const EDGE_DIM = makeEdgeMaterial(theme.colors.invalidDim, WIDTH);

/**
 * Single shared "latest block" material: only one block is the tip at a
 * time, and SceneView breathes its opacity globally — cheaper and
 * simpler than per-instance clones.
 */
export const EDGE_LATEST = makeEdgeMaterial(
	boosted(theme.colors.active, theme.boost.latest),
	WIDTH,
	{ transparent: true },
);

export function blockPosition(index: number): THREE.Vector3 {
	return new THREE.Vector3(index * theme.layout.blockSpacing, SIZE / 2, 0);
}

/** index + truncated hash label, drawn once on a small canvas. */
function drawLabel(
	ctx: CanvasRenderingContext2D,
	title: string,
	hash: string,
	options: { strike?: boolean } = {},
): void {
	const { width, height } = ctx.canvas;
	ctx.clearRect(0, 0, width, height);
	ctx.textAlign = 'center';

	ctx.font = '500 30px "Geist", ui-sans-serif, sans-serif';
	ctx.fillStyle = cssColor(theme.colors.edge);
	ctx.fillText(title, width / 2, 38);

	ctx.font = '400 24px "Geist Mono", ui-monospace, monospace';
	ctx.fillStyle = options.strike ? cssColor(theme.colors.invalid) : cssColor(theme.colors.textSecondary);
	ctx.fillText(hash, width / 2, 74);
	if (options.strike) {
		const w = ctx.measureText(hash).width;
		ctx.strokeStyle = cssColor(theme.colors.invalid);
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo(width / 2 - w / 2, 66);
		ctx.lineTo(width / 2 + w / 2, 66);
		ctx.stroke();
	}
}

export function shortHash(hash: string): string {
	return `0x${hash.slice(0, 4)}…${hash.slice(-4)}`;
}

/** 1381.4 → "1,381" · 42.31 → "42.3" · 0.0042 → "0.004" */
export function formatVolume(btcValue: number): string {
	if (btcValue >= 1_000) return Math.round(btcValue).toLocaleString('en-US');
	if (btcValue >= 10) return btcValue.toFixed(1);
	return btcValue.toFixed(3);
}

export class BlockMesh {
	readonly group = new THREE.Group();
	readonly index: number;
	/** the block's hash — lets the scene find meshes by identity (reorgs) */
	readonly blockHash: string;
	/** raycast target carrying userData.block */
	readonly body: THREE.Mesh;
	/** mini cubes for the block's transactions (hover targets) */
	readonly txCubes: TxCubeMesh[] = [];

	private readonly edges: LineSegments2;
	private readonly labelCtx: CanvasRenderingContext2D;
	private readonly labelTexture: THREE.CanvasTexture;
	private readonly info: BlockInfo;
	private dimmed = false;
	private latest = false;

	/**
	 * @param displayIndex position along the scene's chain axis — the
	 *   arrival order, NOT the block height. Simulated chains start at 0
	 *   so both coincide; live Bitcoin heights (~900 000) would put the
	 *   cube three million units away, so the scene maps order → space
	 *   and the label keeps the real height.
	 */
	constructor(info: BlockInfo, displayIndex: number = info.index) {
		this.index = info.index;
		this.blockHash = info.hash;
		this.info = info;
		this.group.position.copy(blockPosition(displayIndex));

		this.body = new THREE.Mesh(CUBE_GEOMETRY, BODY_MATERIAL);
		this.body.userData.block = info;
		this.edges = new LineSegments2(CUBE_EDGES, info.index === 0 ? EDGE_GENESIS : EDGE_NORMAL);
		this.group.add(this.body, this.edges);

		// Label sprite below the cube: "#N" + truncated hash in Mono.
		const canvas = document.createElement('canvas');
		canvas.width = 256;
		canvas.height = 96;
		this.labelCtx = canvas.getContext('2d')!;
		drawLabel(this.labelCtx, info.index === 0 ? 'genesis' : `#${info.index}`, shortHash(info.hash));
		this.labelTexture = new THREE.CanvasTexture(canvas);
		const label = new THREE.Sprite(
			// depthTest off: a label is an annotation, not scene geometry —
			// it must never disappear behind a neighboring cube
			new THREE.SpriteMaterial({ map: this.labelTexture, transparent: true, depthTest: false }),
		);
		label.renderOrder = 10; // draw after everything it annotates
		label.scale.set(2.2, 0.82, 1);
		label.position.y = -(SIZE / 2 + 0.65);
		registerLabel(label); // keep readable at any zoom
		this.group.add(label);

		// Live blocks carry THOUSANDS of transactions — summarized as text
		// painted on the cube's top face (count + volume moved), never as
		// individual cubes.
		if (info.txCount !== undefined && info.transactions.length === 0) {
			this.addFaceStats(info.txCount, info.totalVolume);
		}

		// The block's transactions rest ON THE FLOOR beside the cube's +z
		// face — which reads as screen bottom-left at the iso angle — in
		// pairs of two: a tidy grid-aligned receipt pad, not a floating
		// crown above the block.
		info.transactions.forEach((tx, i) => {
			const cube = new TxCubeMesh(tx);
			cube.setState('mined');
			if (!tx.coinbase && tx.signatureValid) cube.addSeal();
			const column = i % 2;
			const row = Math.floor(i / 2);
			cube.group.position.set(
				(column - 0.5) * theme.layout.txPadSpacing,
				-(SIZE / 2) + theme.layout.txCubeSize / 2, // floor level
				SIZE / 2 + theme.layout.txPadGap + row * theme.layout.txPadSpacing,
			);
			this.txCubes.push(cube);
			this.group.add(cube.group);
		});
	}

	/**
	 * Live-block summary painted on the TOP FACE: tx count and the
	 * cumulative BTC moved. Part of the cube's geometry (scales with it,
	 * unlike the floating labels), rotated 45° in-plane so the text
	 * reads horizontally from the isometric camera.
	 */
	private addFaceStats(txCount: number, totalVolume?: number): void {
		const canvas = document.createElement('canvas');
		canvas.width = 256;
		canvas.height = 128;
		const ctx = canvas.getContext('2d')!;
		ctx.textAlign = 'center';
		ctx.fillStyle = cssColor(theme.colors.edge);
		ctx.font = '500 44px "Geist Mono", ui-monospace, monospace';
		ctx.fillText(`${txCount.toLocaleString('en-US')} tx`, 128, totalVolume === undefined ? 76 : 52);
		if (totalVolume !== undefined) {
			ctx.fillStyle = cssColor(theme.colors.textSecondary);
			ctx.font = '400 32px "Geist Mono", ui-monospace, monospace';
			ctx.fillText(`${formatVolume(totalVolume)} BTC`, 128, 100);
		}

		const plane = new THREE.Mesh(
			new THREE.PlaneGeometry(SIZE * 0.94, SIZE * 0.47),
			new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }),
		);
		plane.rotation.x = -Math.PI / 2;
		plane.rotation.z = -Math.PI / 4; // face the iso camera's azimuth
		plane.position.y = SIZE / 2 + 0.012;
		this.group.add(plane);
	}

	/** The breathing blue tip treatment — exactly one block at a time. */
	setLatest(latest: boolean): void {
		this.latest = latest;
		this.applyEdgeMaterial();
	}

	/** Downstream-of-a-break: edges dim to red-tinted gray. */
	setDimmed(dimmed: boolean): void {
		this.dimmed = dimmed;
		this.applyEdgeMaterial();
	}

	private applyEdgeMaterial(): void {
		this.edges.material = this.dimmed
			? EDGE_DIM
			: this.latest
				? EDGE_LATEST
				: this.index === 0
					? EDGE_GENESIS
					: EDGE_NORMAL;
	}

	/** Brief edge-brightness pop, used by the confirmation ripple. */
	flashEdges(material: LineMaterial, durationSec: number): void {
		const previous = this.edges.material;
		this.edges.material = material;
		setTimeout(() => {
			// Only restore if nothing else (tamper, latest…) changed it.
			if (this.edges.material === material) this.edges.material = previous;
		}, durationSec * 1000);
	}

	/** TamperAnimation support: stored hash struck through, mismatch typed in. */
	markHashMismatch(): void {
		drawLabel(this.labelCtx, `#${this.index}`, shortHash(this.info.hash), { strike: true });
		this.labelTexture.needsUpdate = true;
	}

	restoreLabel(): void {
		drawLabel(this.labelCtx, this.index === 0 ? 'genesis' : `#${this.index}`, shortHash(this.info.hash));
		this.labelTexture.needsUpdate = true;
	}
}
