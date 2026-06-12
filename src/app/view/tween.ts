import { prefersReducedMotion, theme } from './theme';

/**
 * # Tweens — a ~60-line tween engine
 *
 * Why not gsap? Three reasons:
 *  1. it would add a dependency the size of our whole app to do lerp
 *     math we can write in a page;
 *  2. gsap runs on its own ticker — this engine updates inside the
 *     existing render loop, so animations stay frame-locked with the
 *     scene and pause with it;
 *  3. reduced-motion support is one `if` here instead of plugin config.
 *
 * Every animation in view/animations/ is built from these primitives:
 * run() drives a 0→1 progress callback through an easing curve, and the
 * returned promise makes choreography plain `await` sequences.
 */

export type Easing = (t: number) => number;

export interface TweenHandle {
	cancel(): void;
	/** Resolves when the tween completes (or is cancelled). */
	readonly finished: Promise<void>;
}

interface ActiveTween {
	elapsed: number;
	delay: number;
	duration: number;
	easing: Easing;
	onUpdate: (t: number) => void;
	resolve: () => void;
	cancelled: boolean;
}

export class Tweens {
	private active: ActiveTween[] = [];

	/**
	 * Drive `onUpdate(progress)` from 0 to 1 over `duration` seconds.
	 * With prefers-reduced-motion the tween completes instantly — the
	 * end state still happens, only the motion is skipped.
	 */
	run(
		duration: number,
		onUpdate: (t: number) => void,
		options: { easing?: Easing; delaySec?: number } = {},
	): TweenHandle {
		if (prefersReducedMotion()) {
			onUpdate(1);
			return { cancel: () => undefined, finished: Promise.resolve() };
		}

		let resolve!: () => void;
		const finished = new Promise<void>((r) => (resolve = r));
		const tween: ActiveTween = {
			elapsed: 0,
			delay: options.delaySec ?? 0,
			duration,
			easing: options.easing ?? theme.easing.inOut,
			onUpdate,
			resolve,
			cancelled: false,
		};
		this.active.push(tween);
		return {
			cancel: () => {
				tween.cancelled = true;
				tween.resolve();
			},
			finished,
		};
	}

	/** A pure pause that respects reduced-motion (resolves immediately). */
	wait(seconds: number): Promise<void> {
		return this.run(seconds, () => undefined).finished;
	}

	/** Advance all tweens; call once per frame from the render loop. */
	update(dt: number): void {
		this.active = this.active.filter((tween) => {
			if (tween.cancelled) return false;
			if (tween.delay > 0) {
				tween.delay -= dt;
				if (tween.delay > 0) return true;
			}
			tween.elapsed += dt;
			const t = Math.min(tween.elapsed / tween.duration, 1);
			tween.onUpdate(tween.easing(t));
			if (t >= 1) {
				tween.resolve();
				return false;
			}
			return true;
		});
	}
}
