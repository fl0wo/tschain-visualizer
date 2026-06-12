import * as THREE from 'three';
import { registerLabel, unregisterLabel } from '../labels';
import { cssColor, theme } from '../theme';

/**
 * A canvas-backed sprite for in-scene text — used by the signing
 * typewriter and the live mining readout. All in-scene strings are
 * Geist Mono per the design system; only the canvas redraws, the
 * texture object is stable.
 */
export class TextSprite {
	readonly sprite: THREE.Sprite;
	private readonly ctx: CanvasRenderingContext2D;
	private readonly texture: THREE.CanvasTexture;

	constructor(worldWidth: number) {
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 128;
		this.ctx = canvas.getContext('2d')!;
		this.texture = new THREE.CanvasTexture(canvas);
		this.sprite = new THREE.Sprite(
			new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthTest: false }),
		);
		// depthTest:false alone isn't enough — transparent geometry drawn
		// later would still paint over the text; force text to draw last
		this.sprite.renderOrder = 11;
		this.sprite.scale.set(worldWidth, worldWidth / 4, 1);
		registerLabel(this.sprite); // keep readable at any zoom
	}

	/**
	 * Up to two lines of Geist Mono. `highlightPrefix` paints the first N
	 * characters of the second line in teal — how the mining readout
	 * celebrates the leading zeros of a winning hash.
	 */
	set(lines: [string] | [string, string], options: { color?: string; highlightPrefix?: number } = {}): void {
		const { width, height } = this.ctx.canvas;
		const color = options.color ?? cssColor(theme.colors.edge);
		this.ctx.clearRect(0, 0, width, height);
		this.ctx.textAlign = 'center';
		this.ctx.font = '400 34px "Geist Mono", ui-monospace, monospace';

		this.ctx.fillStyle = color;
		this.ctx.fillText(lines[0], width / 2, lines.length === 1 ? 76 : 50);

		if (lines.length === 2) {
			const line = lines[1];
			const n = options.highlightPrefix ?? 0;
			if (n > 0) {
				// split the line so the prefix can take the accent color
				const full = this.ctx.measureText(line).width;
				let x = width / 2 - full / 2;
				this.ctx.textAlign = 'left';
				this.ctx.fillStyle = cssColor(theme.colors.valid);
				this.ctx.fillText(line.slice(0, n), x, 100);
				x += this.ctx.measureText(line.slice(0, n)).width;
				this.ctx.fillStyle = cssColor(theme.colors.textSecondary);
				this.ctx.fillText(line.slice(n), x, 100);
				this.ctx.textAlign = 'center';
			} else {
				this.ctx.fillStyle = cssColor(theme.colors.textSecondary);
				this.ctx.fillText(line, width / 2, 100);
			}
		}
		this.texture.needsUpdate = true;
	}

	set opacity(value: number) {
		(this.sprite.material as THREE.SpriteMaterial).opacity = value;
	}

	dispose(): void {
		unregisterLabel(this.sprite);
		this.texture.dispose();
		(this.sprite.material as THREE.SpriteMaterial).dispose();
	}
}
