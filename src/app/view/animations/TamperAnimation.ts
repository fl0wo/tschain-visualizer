import type { BlockMesh } from '../BlockMesh';
import { theme } from '../theme';
import type { Tweens } from '../tween';

/**
 * # TamperAnimation
 *
 * History was silently edited. The tampered block betrays it with a
 * brief red glitch — scale jitter, like corrupted data — and its
 * stored-hash label strikes through: the hash on record no longer
 * matches what the contents produce.
 *
 * (The *cascade* — downstream links snapping red one after another — is
 * choreographed by SceneView.applyValidation, because it spans many
 * meshes; this class owns the single-block glitch.)
 */
export class TamperAnimation {
	readonly finished: Promise<void>;

	constructor(block: BlockMesh, tweens: Tweens) {
		block.markHashMismatch();
		this.finished = tweens
			.run(theme.timing.glitch, (t) => {
				// Deterministic pseudo-jitter from incommensurate sines:
				// reads as digital corruption, costs no RNG state.
				const decay = 1 - t;
				block.group.scale.set(
					1 + Math.sin(t * 71) * 0.06 * decay,
					1 + Math.sin(t * 53 + 1) * 0.06 * decay,
					1 + Math.sin(t * 89 + 2) * 0.06 * decay,
				);
			})
			.finished.then(() => {
				block.group.scale.setScalar(1);
			});
	}
}
