import type * as THREE from 'three';

/**
 * Zoom-compensated text sprites. The orthographic camera scales the
 * whole world uniformly, so labels drawn in world units become
 * unreadable when zoomed out. Map apps solve this by giving labels a
 * constant SCREEN size: every frame the sprite's world scale is its
 * base scale × 1/zoom, so dezooming grows the label in world terms by
 * exactly as much as the camera shrank it.
 *
 * Same registry pattern as edgeMaterials: sprites are created all over
 * the view, SceneView pushes the camera zoom in once per frame.
 */

const registry = new Map<THREE.Sprite, { x: number; y: number }>();

/** Call AFTER setting the sprite's intended (zoom-1) scale. */
export function registerLabel(sprite: THREE.Sprite): void {
	registry.set(sprite, { x: sprite.scale.x, y: sprite.scale.y });
}

/** Pair with dispose() on transient labels, or the registry leaks. */
export function unregisterLabel(sprite: THREE.Sprite): void {
	registry.delete(sprite);
}

export function compensateLabelZoom(zoom: number): void {
	const factor = 1 / zoom;
	for (const [sprite, base] of registry) {
		sprite.scale.set(base.x * factor, base.y * factor, 1);
	}
}
