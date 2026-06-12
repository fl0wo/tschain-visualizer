import * as THREE from 'three';
import { cssColor, theme } from './theme';

const SIZE = theme.layout.cubeSize;

/**
 * Text painted on a cube's TOP FACE, anchored at its top-left corner
 * (as seen from the iso camera) and running along the left border —
 * one shared implementation so mined blocks and projection ghosts
 * carry exactly the same decal style. Geometry-scaled like the face it
 * sits on (deliberately NOT zoom-compensated, unlike floating labels).
 */
export class FaceLabel {
	readonly mesh: THREE.Mesh;
	private readonly ctx: CanvasRenderingContext2D;
	private readonly texture: THREE.CanvasTexture;

	constructor() {
		const canvas = document.createElement('canvas');
		canvas.width = 256;
		canvas.height = 128;
		this.ctx = canvas.getContext('2d')!;
		this.texture = new THREE.CanvasTexture(canvas);

		const planeW = SIZE * 0.94;
		const planeH = SIZE * 0.47;
		this.mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(planeW, planeH),
			new THREE.MeshBasicMaterial({ map: this.texture, transparent: true }),
		);
		this.mesh.rotation.x = -Math.PI / 2;
		// 90°: baseline along a side of the square face — of the four
		// edge-aligned options, the one reading left→right and right-side-
		// up from the isometric camera.
		this.mesh.rotation.z = Math.PI / 2;
		// Anchor at the face's top-left corner: with the 90° spin, the
		// glyph-top side maps to −x and the reading start to +z, so hug
		// the x=−s border and start at z=+s.
		const inset = 0.06;
		this.mesh.position.set(
			-(SIZE / 2) + inset + planeH / 2,
			SIZE / 2 + 0.012,
			SIZE / 2 - inset - planeW / 2,
		);
	}

	/** Primary line bright, optional secondary line muted — redrawable. */
	set(primary: string, secondary?: string): void {
		const { width, height } = this.ctx.canvas;
		this.ctx.clearRect(0, 0, width, height);
		this.ctx.textAlign = 'left';
		this.ctx.fillStyle = cssColor(theme.colors.edge);
		this.ctx.font = '500 44px "Geist Mono", ui-monospace, monospace';
		this.ctx.fillText(primary, 8, secondary === undefined ? 76 : 52);
		if (secondary !== undefined) {
			this.ctx.fillStyle = cssColor(theme.colors.textSecondary);
			this.ctx.font = '400 32px "Geist Mono", ui-monospace, monospace';
			this.ctx.fillText(secondary, 8, 100);
		}
		this.texture.needsUpdate = true;
	}

	dispose(): void {
		this.texture.dispose();
		(this.mesh.material as THREE.Material).dispose();
		this.mesh.geometry.dispose();
	}
}
