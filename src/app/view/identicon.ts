import { cssColor, theme } from './theme';

/**
 * Tiny deterministic identicon: a 5×5 horizontally-mirrored pixel grid
 * derived from the public key's hex digits — the same key always renders
 * the same avatar, and two keys are visually distinct at a glance.
 *
 * Stays inside the design system: cells are drawn in a single muted hue
 * derived from the key, on the panel's near-black, so the wallet list
 * reads monochrome with a whisper of identity color.
 */
export function identiconDataUrl(pubkeyHex: string): string {
	const canvas = document.createElement('canvas');
	const cells = 5;
	const scale = 6;
	canvas.width = cells * scale;
	canvas.height = cells * scale;
	const ctx = canvas.getContext('2d')!;

	ctx.fillStyle = cssColor(theme.colors.blockBody);
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	// Hue from the key's tail, kept desaturated and light.
	const hue = parseInt(pubkeyHex.slice(-4), 16) % 360;
	ctx.fillStyle = `hsl(${hue} 35% 72%)`;

	// 3 columns decide the pattern; columns 4–5 mirror 2–1.
	for (let row = 0; row < cells; row++) {
		for (let col = 0; col < 3; col++) {
			const digit = parseInt(pubkeyHex[(row * 3 + col) % pubkeyHex.length]!, 16);
			if (digit % 2 === 0) continue;
			ctx.fillRect(col * scale, row * scale, scale, scale);
			ctx.fillRect((cells - 1 - col) * scale, row * scale, scale, scale);
		}
	}
	return canvas.toDataURL();
}
