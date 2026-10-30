/**
 * The endless ground around the heightmap (and around the far map, when there is one): low-frequency value
 * noise that the maps fade into over a band along their edges, so the terrain has no border, no thickness,
 * and dissolves into the fog.
 *
 * MIRROR OF web/src/lib/gl/chunks/noise.glsl (latticeHash, valueNoise) and terrain.glsl (farFbm,
 * coreMask, terrain height): the CPU (camera, picking) and the GPU must agree on the ground. Change both
 * together.
 */

/** Read live (dev panel). */
export interface FarFieldSettings {
	/** Height variation of the far field, ± world units around its base. */
	amplitude: number;
	/** Feature size of the far field, world units. */
	scale: number;
	/** Width of the blend band inside a map's edges (heightmap, far map), as a fraction of its smaller side. */
	blend: number;
	/** Offset added to the base level (the mean height of the outermost map's edges). */
	offset: number;
}

/** Integer hash of a lattice point → [0, 1), with 24-bit precision so GLSL floats match exactly. */
export function latticeHash(ix: number, iy: number): number {
	let h = (Math.imul(ix, 0x8da6b343) ^ Math.imul(iy, 0xd8163841)) >>> 0;
	h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
	h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
	h = (h ^ (h >>> 16)) >>> 0;
	return (h >>> 8) / 16777216;
}

/** Value noise in [0, 1], quintic interpolation. */
export function valueNoise(x: number, y: number): number {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const fx = x - ix;
	const fy = y - iy;
	const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
	const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
	const a = latticeHash(ix, iy);
	const b = latticeHash(ix + 1, iy);
	const c = latticeHash(ix, iy + 1);
	const d = latticeHash(ix + 1, iy + 1);
	const top = a + (b - a) * ux;
	const bottom = c + (d - c) * ux;
	return top + (bottom - top) * uy;
}

/** Four octaves of value noise, normalised to [0, 1]. */
export function farFbm(x: number, y: number): number {
	let sum = 0;
	let amp = 0.5;
	let norm = 0;
	for (let o = 0; o < 4; o++) {
		sum += valueNoise(x, y) * amp;
		norm += amp;
		x = x * 2.03 + 17.1;
		y = y * 2.03 - 9.7;
		amp *= 0.5;
	}
	return sum / norm;
}

/** 1 well inside a map (min, max: its bounds), fading to 0 at its edges over `band` world units; 0 outside. */
export function coreMask(
	x: number,
	z: number,
	min: readonly number[],
	max: readonly number[],
	band: number
): number {
	const d = Math.min(x - min[0], max[0] - x, z - min[2], max[2] - z);
	const t = Math.min(1, Math.max(0, d / band));
	return t * t * (3 - 2 * t);
}
