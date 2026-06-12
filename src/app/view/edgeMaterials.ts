import type * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/**
 * WebGL ignores `linewidth` on ordinary lines: every edge renders one
 * device pixel wide, and after FXAA + DPR downscaling a 1px white line
 * on black averages out to a dull gray — the death of an edge-lit
 * aesthetic. The fat-line addon (LineSegments2/LineMaterial) draws
 * screen-space quads with a real pixel width instead.
 *
 * LineMaterial needs the viewport resolution as a uniform. Materials
 * are created at module-import time, before any renderer exists, so
 * this factory keeps a registry and SceneView pushes the resolution in
 * on startup and on every resize.
 */

const registry: LineMaterial[] = [];

export function makeEdgeMaterial(
	color: THREE.Color | number,
	linewidthPx: number,
	options: { transparent?: boolean } = {},
): LineMaterial {
	const material = new LineMaterial({
		color: color as number, // LineMaterial accepts Color instances too; its typing lags
		linewidth: linewidthPx, // in pixels (worldUnits stays false)
		transparent: options.transparent ?? false,
	});
	registry.push(material);
	return material;
}

export function updateEdgeResolutions(width: number, height: number): void {
	for (const material of registry) material.resolution.set(width, height);
}
