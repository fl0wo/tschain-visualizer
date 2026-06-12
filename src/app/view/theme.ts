import * as THREE from 'three';

/**
 * # theme.ts — the single tuning surface for the whole look
 *
 * Every color, timing, easing and post-processing value lives here, used
 * by BOTH the three.js materials and the HUD CSS (via CSS custom
 * properties injected at startup). Change a number here and the scene
 * and the DOM stay in agreement.
 *
 * Colors are organized as swappable PALETTES: every color slot has a
 * semantic role (active / valid / pending / invalid, plus structural
 * tones), and a palette fills those roles. Switch the look by changing
 * the one `palette` line below — nothing else needs to know.
 */
export interface Palette {
	/** scene + page background */
	background: number;
	/** floor grid lines (fade out via fog) */
	grid: number;
	/** block body — near-background so only the edges speak */
	blockBody: number;
	/** primary edge-lit wireframe (genesis) + primary text */
	edge: number;
	/** mined/settled tx cube edges (quiet) */
	edgeQuiet: number;
	/** panel borders / structural lines */
	border: number;
	/** secondary text */
	textSecondary: number;
	/** selection, focus, active mining, latest block */
	active: number;
	/** verified signatures, intact links, confirmations, settled blocks */
	valid: number;
	/** mempool transactions awaiting mining */
	pending: number;
	/** broken links, rejections, failed verification */
	invalid: number;
	/** edges of blocks downstream of a break (dimmed invalid) */
	invalidDim: number;
}

export const palettes = {
	/** the original look: near-black monochrome + Geist accents */
	vercel: {
		background: 0x0a0a0a,
		grid: 0x1a1a1a,
		blockBody: 0x111111,
		edge: 0xededed,
		edgeQuiet: 0x555555,
		border: 0x333333,
		textSecondary: 0xa1a1a1,
		active: 0x0070f3,
		valid: 0x50e3c2,
		pending: 0xf5a623,
		invalid: 0xee0000,
		invalidDim: 0x5a3333,
	},
	/**
	 * Cyberpunk Neon — the five stars:
	 *   Oxford Blue #070F34 (background) · Zaffre #0313A6 (grid floor)
	 *   Dark Violet #9201CB (active) · Hollywood Cerise #F715AB (pending)
	 *   Fluorescent Cyan #34EDF3 (valid)
	 * Structural tones (borders, text, bodies) are derived tints of
	 * Oxford Blue/Zaffre; invalid is a neon red kept OUTSIDE the five so
	 * errors never share a hue with pending cerise.
	 */
	cyberpunkNeon: {
		background: 0x070f34,
		grid: 0x0313a6,
		blockBody: 0x0b1444,
		edge: 0xe9f1ff,
		edgeQuiet: 0x51619e,
		border: 0x1c2a6e,
		textSecondary: 0x93a4e8,
		active: 0x9201cb,
		valid: 0x34edf3,
		pending: 0xf715ab,
		invalid: 0xff1f3d,
		invalidDim: 0x5a1f3a,
	},
} satisfies Record<string, Palette>;

/* ── ACTIVE PALETTE — swap this one line to retheme everything ────── */
const palette: Palette = palettes.cyberpunkNeon;

export const theme = {
	colors: palette,

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
		/** signature seal rings on tx cubes — in gamut, below the bloom
		 *  threshold: a stable teal ring, not a glowing one */
		seal: 1.2,
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

	/** hover/pinned dialog callout: dot · leader line · dot · card.
	 *  The leader runs at 45° — up-right for transactions (anchored at
	 *  the cube top), down-left for blocks (anchored at the base) —
	 *  flipping to the other diagonal when the screen edge demands it. */
	callout: {
		/** diagonal distance (px) between the anchor dot and the card dot */
		liftPx: 104,
		/** leader incline, degrees away from vertical (0 = straight up/down) */
		angleDeg: 20,
		dotPx: 5,
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
	root.setProperty('--active', cssColor(theme.colors.active));
	root.setProperty('--valid', cssColor(theme.colors.valid));
	root.setProperty('--pending', cssColor(theme.colors.pending));
	root.setProperty('--invalid', cssColor(theme.colors.invalid));
	root.setProperty('--hover-ms', `${theme.timing.hoverMs}ms`);
	root.setProperty('--ticker-ms', `${theme.timing.tickerMs}ms`);
	root.setProperty('--callout-lift', `${theme.callout.liftPx}px`);
	// decompose the inclined leader into x/y components (and the 5px
	// dot-gap along the same direction) so the CSS stays angle-agnostic
	const rad = (theme.callout.angleDeg * Math.PI) / 180;
	root.setProperty('--callout-angle', `${theme.callout.angleDeg}deg`);
	root.setProperty('--callout-run-x', `${(theme.callout.liftPx * Math.sin(rad)).toFixed(1)}px`);
	root.setProperty('--callout-run-y', `${(theme.callout.liftPx * Math.cos(rad)).toFixed(1)}px`);
	root.setProperty('--callout-gap-x', `${(5 * Math.sin(rad)).toFixed(2)}px`);
	root.setProperty('--callout-gap-y', `${(5 * Math.cos(rad)).toFixed(2)}px`);
	root.setProperty('--callout-dot', `${theme.callout.dotPx}px`);
}
