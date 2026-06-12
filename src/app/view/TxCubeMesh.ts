import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { TxInfo } from '../model/ChainModel';
import { makeEdgeMaterial } from './edgeMaterials';
import { boosted, theme } from './theme';
import type { TweenHandle } from './tween';

/**
 * A transaction is a miniature block: same edge-lit cube language as the
 * chain itself, just smaller. Amber edges while pending in the mempool,
 * quiet gray once mined into a block. A small teal "seal" ring appears
 * after the SigningAnimation and stays with the cube for life — the
 * visual record that this payload carries a verified signature.
 */

const TX_GEOMETRY = new THREE.BoxGeometry(
	theme.layout.txCubeSize,
	theme.layout.txCubeSize,
	theme.layout.txCubeSize,
);
const TX_EDGES = new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(TX_GEOMETRY));
const SEAL_GEOMETRY = new THREE.TorusGeometry(theme.layout.txCubeSize * 0.42, 0.018, 8, 32);

const BODY_MATERIAL = new THREE.MeshBasicMaterial({ color: theme.colors.blockBody });
const EDGE_PENDING = makeEdgeMaterial(boosted(theme.colors.amber, theme.boost.edges), theme.edgeWidth.tx);
const EDGE_MINED = makeEdgeMaterial(theme.colors.edgeQuiet, theme.edgeWidth.tx);
const EDGE_REJECTED = makeEdgeMaterial(boosted(theme.colors.red, theme.boost.edges), theme.edgeWidth.tx);
const SEAL_MATERIAL = new THREE.MeshBasicMaterial({ color: boosted(theme.colors.teal, theme.boost.seal) });

export class TxCubeMesh {
	readonly group = new THREE.Group();
	/** raycast target carrying userData.tx for the tooltip */
	readonly body: THREE.Mesh;
	private readonly edges: LineSegments2;
	private seal: THREE.Mesh | null = null;
	/** in-flight intro tweens, cancelled if the cube gets drained early */
	readonly activeHandles: TweenHandle[] = [];

	constructor(tx: TxInfo | null) {
		this.body = new THREE.Mesh(TX_GEOMETRY, BODY_MATERIAL);
		if (tx) this.body.userData.tx = tx;
		this.edges = new LineSegments2(TX_EDGES, EDGE_PENDING);
		this.group.add(this.body, this.edges);
	}

	setState(state: 'pending' | 'mined' | 'rejected'): void {
		this.edges.material =
			state === 'pending' ? EDGE_PENDING : state === 'mined' ? EDGE_MINED : EDGE_REJECTED;
	}

	/** The persistent teal seal left behind by the SigningAnimation. */
	addSeal(): void {
		if (this.seal) return;
		this.seal = new THREE.Mesh(SEAL_GEOMETRY, SEAL_MATERIAL);
		this.seal.rotation.x = Math.PI / 2;
		this.seal.position.y = theme.layout.txCubeSize * 0.62;
		this.group.add(this.seal);
	}

	cancelIntro(): void {
		for (const handle of this.activeHandles) handle.cancel();
		this.activeHandles.length = 0;
	}
}
