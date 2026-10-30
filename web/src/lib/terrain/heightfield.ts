/**
 * CPU copy of the terrain heightmap (format: doc/formats/heightmap.md). Sampling matches the GPU's
 * LINEAR + CLAMP_TO_EDGE filtering, so the CPU and the shader agree on the height. Code that needs the
 * ground (camera, picking) goes through Ground (ground.ts), which adds the endless far field around it.
 * Also prepares the GPU's copy: each normalized height split into two half floats (RG16F, filterable in core
 * WebGL2), a main value and the remainder × 2048, which the shaders add back (terrain.glsl): a 16-bit
 * integer file keeps its full precision (half floats alone step by 1/2048 in the upper half).
 */

export type Vec3 = [number, number, number];

export interface HeightmapMeta {
	version: 1;
	width: number;
	height: number;
	/** 'r16': 16-bit unsigned integers (evenly spaced, the exporters' format); 'r16f': half floats (older files). */
	format: 'r16' | 'r16f';
	bounds: { min: Vec3; max: Vec3 };
}

/** The remainder's scale in the GPU copy's second channel (terrain.glsl adds back `g / 2048`). */
export const REMAINDER_SCALE = 2048;

export interface TerrainMapsMeta {
	version: 1;
	/** Unit vector toward the sun, as used for the bake. */
	sunDir: Vec3;
}

export class Heightfield {
	/** World heights, row-major (index = j * width + i, i along +X, j along +Z). */
	readonly heights: Float32Array;
	/** Mean height along the four edges: the level the far field continues at (see ground.ts). */
	readonly edgeMean: number;
	/** The GPU copy, ready for an RG16F upload: per sample, half(v) then half((v − that) × REMAINDER_SCALE). */
	readonly texels: Uint16Array;

	constructor(
		readonly meta: HeightmapMeta,
		/** The file's samples: 16-bit integers ('r16') or half floats ('r16f'), normalized 0..1. */
		raw: Uint16Array
	) {
		const { min, max } = meta.bounds;
		const range = max[1] - min[1];
		this.heights = new Float32Array(raw.length);
		this.texels = new Uint16Array(raw.length * 2);
		for (let k = 0; k < raw.length; k++) {
			let main: number;
			let v: number;
			if (meta.format === 'r16f') {
				main = raw[k];
				v = HALF_TO_FLOAT[main];
			} else {
				v = raw[k] / 65535;
				main = floatToHalf(v);
			}
			this.heights[k] = min[1] + v * range;
			this.texels[k * 2] = main;
			this.texels[k * 2 + 1] = floatToHalf((v - HALF_TO_FLOAT[main]) * REMAINDER_SCALE);
		}

		const { width, height } = meta;
		let sum = 0;
		for (let i = 0; i < width; i++) sum += this.heights[i] + this.heights[(height - 1) * width + i];
		for (let j = 0; j < height; j++) sum += this.heights[j * width] + this.heights[j * width + width - 1];
		this.edgeMean = sum / (2 * (width + height));
	}

	/** Ground height at a world position, bilinear between sample centres, clamped at the edges. */
	heightAt(x: number, z: number): number {
		const { width, height, bounds } = this.meta;
		const u = clamp(((x - bounds.min[0]) / (bounds.max[0] - bounds.min[0])) * width - 0.5, 0, width - 1);
		const v = clamp(((z - bounds.min[2]) / (bounds.max[2] - bounds.min[2])) * height - 0.5, 0, height - 1);
		const i0 = Math.floor(u);
		const j0 = Math.floor(v);
		const i1 = Math.min(i0 + 1, width - 1);
		const j1 = Math.min(j0 + 1, height - 1);
		const fu = u - i0;
		const fv = v - j0;
		const h = this.heights;
		const top = h[j0 * width + i0] + (h[j0 * width + i1] - h[j0 * width + i0]) * fu;
		const bottom = h[j1 * width + i0] + (h[j1 * width + i1] - h[j1 * width + i0]) * fu;
		return top + (bottom - top) * fv;
	}
}

const cache = new Map<string, Promise<Heightfield>>();

/** Fetch and decode a heightmap once per URL (pure data: it outlives GL contexts and navigation). */
export function loadHeightfield(url: string, meta: HeightmapMeta): Promise<Heightfield> {
	let promise = cache.get(url);
	if (!promise) {
		promise = fetch(url)
			.then((response) => {
				if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
				return response.arrayBuffer();
			})
			.then((buffer) => {
				const expected = meta.width * meta.height * 2;
				if (buffer.byteLength !== expected) {
					throw new Error(`${url}: ${buffer.byteLength} bytes, expected ${expected}`);
				}
				return new Heightfield(meta, new Uint16Array(buffer));
			});
		promise.catch(() => cache.delete(url)); // allow a retry
		cache.set(url, promise);
	}
	return promise;
}

/** Validate heightmap.json (or farmap.json, the same format); throws with a clear message instead of rendering garbage. */
export function parseHeightmapMeta(json: unknown, name = 'heightmap.json'): HeightmapMeta {
	const m = json as Partial<HeightmapMeta>;
	if (m?.version !== 1) throw new Error(`${name}: unsupported version ${m?.version}`);
	if (m.format !== 'r16' && m.format !== 'r16f') throw new Error(`${name}: unsupported format ${m.format}`);
	if (!(Number(m.width) > 0 && Number(m.height) > 0)) throw new Error(`${name}: bad width/height`);
	if (!isVec3(m.bounds?.min) || !isVec3(m.bounds?.max)) throw new Error(`${name}: bad bounds`);
	return m as HeightmapMeta;
}

/** Validate maps.json; the sun direction is re-normalised. */
export function parseMapsMeta(json: unknown): TerrainMapsMeta {
	const m = json as Partial<TerrainMapsMeta>;
	if (m?.version !== 1) throw new Error(`maps.json: unsupported version ${m?.version}`);
	if (!isVec3(m.sunDir)) throw new Error('maps.json: bad sunDir');
	const [x, y, z] = m.sunDir;
	const length = Math.hypot(x, y, z);
	return { version: 1, sunDir: [x / length, y / length, z / length] };
}

function isVec3(v: unknown): v is Vec3 {
	return Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number');
}

function clamp(v: number, lo: number, hi: number) {
	return v < lo ? lo : v > hi ? hi : v;
}

/** Every IEEE 754 half → float32, so decoding a heightmap is one lookup per sample. */
const HALF_TO_FLOAT = (() => {
	const table = new Float32Array(65536);
	for (let h = 0; h < 65536; h++) {
		const sign = h & 0x8000 ? -1 : 1;
		const exponent = (h >> 10) & 0x1f;
		const mantissa = h & 0x3ff;
		table[h] =
			exponent === 0
				? sign * mantissa * 2 ** -24
				: exponent === 31
					? mantissa
						? NaN
						: sign * Infinity
					: sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
	}
	return table;
})();

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);

/** float32 → IEEE 754 half, rounded to nearest (as scripts/lib/encode.mjs). */
function floatToHalf(value: number): number {
	F32[0] = value;
	const x = U32[0];
	const sign = (x >>> 16) & 0x8000;
	let e = ((x >>> 23) & 0xff) - 127 + 15;
	let m = x & 0x7fffff;
	if (e >= 31) return sign | 0x7c00;
	if (e <= 0) {
		if (e < -10) return sign;
		m = (m | 0x800000) >> (1 - e);
		return sign | ((m + 0x1000) >> 13);
	}
	m += 0x1000;
	if (m & 0x800000) {
		m = 0;
		e++;
		if (e >= 31) return sign | 0x7c00;
	}
	return sign | (e << 10) | (m >> 13);
}
