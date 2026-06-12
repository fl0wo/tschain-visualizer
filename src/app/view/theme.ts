import * as THREE from 'three';

/**
 * # theme.ts — the single tuning surface for the whole look
 *
 * Every color, timing, easing and post-processing value lives here, used
 * by BOTH the three.js materials and the HUD CSS (via CSS custom
 * properties injected at startup). Change a number here and the scene
 * and the DOM stay in agreement.
 *
 * Art direction: Vercel / Geist. Near-black, monochrome-first, edge-lit
 * geometry, and four accent colors that are only ever used with their
 * semantic meaning — blue = active/focus, teal = verified/valid,
 * amber = pending, red = invalid.
 */
export const theme = {
	colors: {
		/** scene + page background */
		background: 0x0a0a0a,
		/** floor grid lines (fade out via fog) */
		grid: 0x1a1a1a,
		/** block body — near-black so only the edges speak */
		blockBody: 0x111111,
		/** primary edge-lit wireframe + primary text */
		edge: 0xededed,
		/** mined/settled tx cube edges (quiet, monochrome) */
		edgeQuiet: 0x555555,
		/** borders / structural gray */
		border: 0x333333,
		/** secondary text */
		textSecondary: 0xa1a1a1,

		// ── semantic accents (used sparingly) ──
		/** selection, focus, active mining */
		blue: 0x0070f3,
		/** valid: signatures, intact links, confirmations, genesis */
		teal: 0x50e3c2,
		/** pending: mempool transactions awaiting mining */
		amber: 0xf5a623,
		/** invalid: broken links, rejections, failed verification */
		red: 0xee0000,
		/** edges of blocks downstream of a break: red-tinted gray */
		redDim: 0x5a3333,
	},

	/**
	 * HDR brightness multipliers. The bloom pass only picks up pixels
	 * brighter than its threshold, so "things that glow" (energy pulse,
	 * seals, shockwave) get pushed above 1.0 while bodies and text stay
	 * below it. This is what keeps the scene precise instead of soupy.
	 *
	 * CAUTION when tuning up: once a channel crosses 1.0 the renderer
	 * clamps it, the hue washes toward white, and bloom amplifies that —
	 * teal × 2 reads as a white flash, not bright teal. Anything that
	 * must stay recognizably COLORED belongs at ~1.0–1.2; only neutral
	 * "energy" elements survive bigger pushes.
	 */
	boost: {
		edges: 1.0,
		/** the breathing blue tip + mining ghost */
		latest: 1.15,
		/** the confirmation ripple flash */
		ripple: 1.2,
		pulse: 2.2,
		seal: 1.6,
		shockwave: 1.8,
	},

	/** fat-line edge widths, in screen pixels */
	edgeWidth: {
		block: 2.0,
		tx: 1.5,
	},

	/** UnrealBloomPass — restrained on purpose: a tight, dim halo on the
	 *  brightest elements only, never a wash over the scene. The 0.95
	 *  threshold sits above the white edges (#ededed ≈ 0.93 luminance),
	 *  so ONLY deliberately HDR-boosted elements (pulse, seals,
	 *  shockwave) bloom at all. */
	bloom: {
		strength: 0.15,
		radius: 0.25,
		threshold: 0.95,
	},

	/**
	 * Fog distances are measured FROM THE CAMERA, which sits
	 * `camera.distance` away — so `near` must start beyond the subject
	 * or the whole scene drowns in it. With the camera following the
	 * tip, old blocks drift past `far` and fade into the dark: history
	 * literally receding into the distance.
	 */
	fog: {
		near: 64,
		far: 130,
	},

	camera: {
		/** classic isometric view direction (normalized at use site) */
		isoDirection: new THREE.Vector3(1, 1, 1),
		/** how far along isoDirection the camera sits from its target */
		distance: 60,
		/** world-units height of the orthographic frustum at zoom 1 */
		viewHeight: 18,
		zoomMin: 0.5,
		zoomMax: 3,
		/** how far the user may swing away from the iso angle (radians) */
		polarSwing: 0.14,
		azimuthSwing: 0.3,
		/** auto-follow: pause while interacting, resume after this idle */
		followIdleMs: 3000,
		/** seconds for the eased pan to frame a new block */
		followDuration: 1.0,
	},

	layout: {
		/** block cube edge length */
		cubeSize: 1.6,
		/** distance between consecutive block centers */
		blockSpacing: 3.6,
		/** mini transaction cube edge length */
		txCubeSize: 0.42,
		/** mempool holding zone, relative to the chain tip */
		mempoolOffset: new THREE.Vector3(1.2, 3.6, -3.4),
		/** where new tx cubes materialize before signing/verification */
		stagingOffset: new THREE.Vector3(0, 1.6, 0),
	},

	/** all in seconds unless suffixed Ms */
	timing: {
		// signing
		signingOrbit: 0.6,
		signingSeal: 0.3,
		signingType: 0.4,
		signingHold: 0.5,
		// verification
		scanSweep: 0.3,
		verifyFlash: 0.25,
		rejectShake: 0.2,
		rejectFall: 1.1,
		// mining
		readoutHz: 10,
		mineLockHold: 0.9,
		shockwave: 0.8,
		txFlight: 0.65,
		txFlightStaggerMs: 60,
		linkDraw: 0.4,
		// confirmations
		ripplePulse: 0.3,
		rippleStaggerMs: 120,
		// tamper
		glitch: 0.4,
		cascadeStaggerMs: 120,
		// ambient
		breathePeriod: 2.0,
		bobPeriod: 2.6,
		bobAmplitude: 0.07,
		pulseSpeed: 5.5, // world units / second along the chain
		// HUD (CSS)
		hoverMs: 150,
		tickerMs: 350,
	},

	easing: {
		inOut: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
		out: (t: number): number => 1 - (1 - t) ** 3,
		in: (t: number): number => t * t * t,
	},
} as const;

/** number color → '#rrggbb' for CSS / canvas use. */
export function cssColor(color: number): string {
	return `#${color.toString(16).padStart(6, '0')}`;
}

/** A THREE.Color pushed into HDR so the bloom pass picks it up. */
export function boosted(color: number, factor: number): THREE.Color {
	return new THREE.Color(color).multiplyScalar(factor);
}

/**
 * Accessibility: when the OS asks for reduced motion, every tween snaps
 * to its end state instantly and ambient motion (bobbing, breathing,
 * the traveling pulse) flattens to static color changes.
 */
export function prefersReducedMotion(): boolean {
	return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Mirror the palette + timings into CSS custom properties so the
 * stylesheet reads from the same source of truth as the materials.
 */
export function applyCssVars(): void {
	const root = document.documentElement.style;
	root.setProperty('--bg', cssColor(theme.colors.background));
	root.setProperty('--text', cssColor(theme.colors.edge));
	root.setProperty('--text-secondary', cssColor(theme.colors.textSecondary));
	root.setProperty('--border', cssColor(theme.colors.border));
	root.setProperty('--blue', cssColor(theme.colors.blue));
	root.setProperty('--teal', cssColor(theme.colors.teal));
	root.setProperty('--amber', cssColor(theme.colors.amber));
	root.setProperty('--red', cssColor(theme.colors.red));
	root.setProperty('--hover-ms', `${theme.timing.hoverMs}ms`);
	root.setProperty('--ticker-ms', `${theme.timing.tickerMs}ms`);
}
