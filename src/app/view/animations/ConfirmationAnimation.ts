import type { BlockMesh } from '../BlockMesh';
import { makeEdgeMaterial } from '../edgeMaterials';
import { boosted, theme } from '../theme';
import type { Tweens } from '../tween';

/**
 * # ConfirmationAnimation
 *
 * When a block lands, every block beneath it just became one
 * confirmation deeper — one more proof-of-work an attacker would have
 * to redo. The ripple makes that abstract fact physical: a brightness
 * pulse runs from the tip backward through the whole chain, block by
 * block, tracing exactly the work that now protects each one.
 */

// The SAME teal as settled block edges, only brighter (×ripple boost):
// the pulse must read as "the green briefly glows", never as a color
// swap — hue changes read as glitches. In-gamut per the boost caution
// in theme.ts: past ~1.2 the clamp turns teal into a white flash.
const RIPPLE_MATERIAL = makeEdgeMaterial(
	boosted(theme.colors.valid, theme.boost.ripple),
	theme.edgeWidth.block,
);

export class ConfirmationAnimation {
	readonly finished: Promise<void>;

	/** `blocks` ordered genesis → tip; the ripple travels tip → block #1.
	 *  Genesis is skipped: it has white edges (it was agreed, not mined),
	 *  and flashing it teal would be exactly the hue swap we avoid. */
	constructor(blocks: readonly BlockMesh[], tweens: Tweens) {
		const waves: Promise<void>[] = [];
		const tip = blocks.length - 1;
		for (let i = tip; i >= 1; i--) {
			const block = blocks[i]!;
			const delaySec = ((tip - i) * theme.timing.rippleStaggerMs) / 1000;
			let fired = false;
			waves.push(
				tweens.run(
					theme.timing.ripplePulse,
					() => {
						if (fired) return;
						fired = true;
						block.flashEdges(RIPPLE_MATERIAL, theme.timing.ripplePulse);
					},
					{ delaySec },
				).finished,
			);
		}
		this.finished = Promise.all(waves).then(() => undefined);
	}
}
