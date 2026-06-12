import * as THREE from 'three';
import type { TxCubeMesh } from '../TxCubeMesh';
import { boosted, cssColor, theme } from '../theme';
import type { Tweens } from '../tween';

/**
 * # VerificationAnimation
 *
 * The network checking a transaction before admitting it to the mempool:
 * a flat blue scan plane sweeps through the cube top-to-bottom (the
 * "reading" of the payload). On success the cube flashes teal under a ✓
 * glyph; on failure it flashes red, shakes, and tumbles off-screen —
 * the mempool wants nothing to do with it. (The HUD ticker prints the
 * exact failed check; this class only performs the verdict.)
 */

const SCAN_GEOMETRY = new THREE.PlaneGeometry(
	theme.layout.txCubeSize * 1.7,
	theme.layout.txCubeSize * 1.7,
);
const SCAN_MATERIAL = new THREE.MeshBasicMaterial({
	color: boosted(theme.colors.blue, theme.boost.seal),
	transparent: true,
	opacity: 0.35,
	side: THREE.DoubleSide,
	depthWrite: false,
});

/** small ✓ sprite, drawn once and shared */
function makeCheckSprite(): THREE.Sprite {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 64;
	const ctx = canvas.getContext('2d')!;
	ctx.font = '600 48px "Geist", ui-sans-serif, sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillStyle = cssColor(theme.colors.teal);
	ctx.fillText('✓', 32, 36);
	const sprite = new THREE.Sprite(
		new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }),
	);
	sprite.scale.setScalar(0.4);
	return sprite;
}
const CHECK_SPRITE = makeCheckSprite();

export class VerificationAnimation {
	readonly finished: Promise<void>;

	constructor(cube: TxCubeMesh, verdict: 'valid' | 'invalid', tweens: Tweens) {
		this.finished = this.play(cube, verdict, tweens);
	}

	private async play(cube: TxCubeMesh, verdict: 'valid' | 'invalid', tweens: Tweens): Promise<void> {
		// The scan: a plane sweeping down through the cube.
		const plane = new THREE.Mesh(SCAN_GEOMETRY, SCAN_MATERIAL);
		plane.rotation.x = -Math.PI / 2;
		cube.group.add(plane);
		const half = theme.layout.txCubeSize * 0.85;
		const scan = tweens.run(theme.timing.scanSweep, (t) => {
			plane.position.y = half - t * half * 2;
		});
		cube.activeHandles.push(scan);
		await scan.finished;
		cube.group.remove(plane);

		if (verdict === 'valid') {
			// Teal flash + check glyph: verified, welcome to the mempool.
			CHECK_SPRITE.removeFromParent();
			CHECK_SPRITE.position.y = theme.layout.txCubeSize;
			cube.group.add(CHECK_SPRITE);
			const flash = tweens.run(theme.timing.verifyFlash, (t) => {
				cube.group.scale.setScalar(1 + 0.12 * Math.sin(t * Math.PI));
			});
			cube.activeHandles.push(flash);
			await flash.finished;
			CHECK_SPRITE.removeFromParent();
			return;
		}

		// Failure: red, a violent little shake…
		cube.setState('rejected');
		const baseX = cube.group.position.x;
		const shake = tweens.run(theme.timing.rejectShake, (t) => {
			// offset from a stored base, never accumulate — additive jitter
			// would random-walk the cube away from its spot
			cube.group.position.x = baseX + Math.sin(t * 40) * 0.05 * (1 - t);
		});
		cube.activeHandles.push(shake);
		await shake.finished;

		// …then gravity and shame: tumble down off-screen, shrinking out.
		const from = cube.group.position.clone();
		const spin = new THREE.Vector3(Math.random() * 4 + 2, Math.random() * 3, Math.random() * 4 + 2);
		const fall = tweens.run(
			theme.timing.rejectFall,
			(t) => {
				cube.group.position.set(from.x + t * 1.5, from.y - t * t * 9, from.z + t);
				cube.group.rotation.set(spin.x * t, spin.y * t, spin.z * t);
				cube.group.scale.setScalar(Math.max(1 - t * 0.7, 0.0001));
			},
			{ easing: theme.easing.in },
		);
		cube.activeHandles.push(fall);
		await fall.finished;
	}
}
