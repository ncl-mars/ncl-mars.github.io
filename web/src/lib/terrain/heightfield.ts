/**
 * CPU copy of the terrain heightmap (format: doc/formats/heightmap.md). Sampling matches the GPU's
 * LINEAR + CLAMP_TO_EDGE filtering, so the CPU and the shader agree on the height. Code that needs the
 * ground (camera, picking) goes through Ground (ground.ts), which adds the endless far field around it.
 * Also holds the GPU's copy: the file's 16-bit integers as they are, uploaded byte by byte (RG8, textures.ts)
 * and put back together by the shaders (terrain.glsl), so they keep their full precision.
 */

export type Vec3 = [number, number, number];

export interface HeightmapMeta {
	version: 1;
	width: number;
	height: number;
	/**
	 * 'r16': 16-bit unsigned integers (evenly spaced); 'r16-med': the same integers packed losslessly (the
	 * exporter's); 'r16f': half floats (older files).
	 */
	format: 'r16' | 'r16-med' | 'r16f';
	bounds: { min: Vec3; max: Vec3 };
}

export interface TerrainMapsMeta {
	/** 2: R is the sun's cast shadow alone (1 baked the light: the sun's angle on the slope times the shadow). */
	version: 2;
	/** Unit vector toward the sun, as used for the bake. */
	sunDir: Vec3;
}

export class Heightfield {
	/** World heights, row-major (index = j * width + i, i along +X, j along +Z). */
	readonly heights: Float32Array;
	/** Mean height along the four edges: the level the far field continues at (see ground.ts). */
	readonly edgeMean: number;
	/** The GPU copy: the normalized heights as 16-bit integers (× 65535), same order; `heights` comes from it. */
	readonly texels: Uint16Array;

	constructor(
		readonly meta: HeightmapMeta,
		/** The file's samples: 16-bit integers ('r16', and 'r16-med' once unpacked) or half floats ('r16f'), normalized 0..1. */
		raw: Uint16Array
	) {
		const { min, max } = meta.bounds;
		const range = max[1] - min[1];
		// Half floats are rounded to the nearest integer step, so the CPU and the GPU read the same values
		this.texels = meta.format === 'r16f' ? halvesToIntegers(raw) : raw;
		this.heights = new Float32Array(raw.length);
		for (let k = 0; k < raw.length; k++) this.heights[k] = min[1] + (this.texels[k] / 65535) * range;

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
				if (meta.format !== 'r16-med') return response.arrayBuffer();
				// Deflated (zlib): the browser inflates it as it downloads
				return new Response(response.body!.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
			})
			.then((buffer) => {
				const expected = meta.width * meta.height * 2;
				if (buffer.byteLength !== expected) {
					throw new Error(`${url}: ${buffer.byteLength} bytes, expected ${expected}`);
				}
				const samples =
					meta.format === 'r16-med' ? unpackMed(new Uint8Array(buffer), meta.width, meta.height) : new Uint16Array(buffer);
				return new Heightfield(meta, samples);
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
	if (m.format !== 'r16' && m.format !== 'r16-med' && m.format !== 'r16f') {
		throw new Error(`${name}: unsupported format ${m.format}`);
	}
	if (!(Number(m.width) > 0 && Number(m.height) > 0)) throw new Error(`${name}: bad width/height`);
	if (!isVec3(m.bounds?.min) || !isVec3(m.bounds?.max)) throw new Error(`${name}: bad bounds`);
	return m as HeightmapMeta;
}

/** Validate maps.json; the sun direction is re-normalised. */
export function parseMapsMeta(json: unknown): TerrainMapsMeta {
	const m = json as Partial<TerrainMapsMeta>;
	const version: unknown = m?.version;
	if (version === 1) throw new Error('maps.json: version 1 baked the light into R, now the shadow alone: re-export the maps');
	if (version !== 2) throw new Error(`maps.json: unsupported version ${version}`);
	if (!isVec3(m.sunDir)) throw new Error('maps.json: bad sunDir');
	const [x, y, z] = m.sunDir;
	const length = Math.hypot(x, y, z);
	return { version: 2, sunDir: [x / length, y / length, z / length] };
}

function isVec3(v: unknown): v is Vec3 {
	return Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number');
}

function clamp(v: number, lo: number, hi: number) {
	return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 'r16-med' once inflated (doc/formats/heightmap.md): each sample is its difference from a guess made from the
 * samples already decoded (MED, as in lossless JPEG-LS: the left, top or planar guess depending on the local
 * edge), modulo 65536 and zigzagged, all the high bytes first, then the low bytes. Exact: the same integers
 * as 'r16'. Mirrors pack_med() in hou/snippets/export_heightmap.py.
 */
function unpackMed(bytes: Uint8Array, width: number, height: number): Uint16Array {
	const n = width * height;
	const out = new Uint16Array(n);
	for (let j = 0, k = 0; j < height; j++) {
		for (let i = 0; i < width; i++, k++) {
			const z = (bytes[k] << 8) | bytes[n + k];
			let guess: number;
			if (j === 0) guess = i === 0 ? 0 : out[k - 1];
			else if (i === 0) guess = out[k - width];
			else {
				const a = out[k - 1];
				const b = out[k - width];
				const c = out[k - width - 1];
				const low = a < b ? a : b;
				const high = a < b ? b : a;
				guess = c >= high ? low : c <= low ? high : a + b - c;
			}
			out[k] = guess + ((z >>> 1) ^ -(z & 1)); // un-zigzagged; the array keeps it modulo 65536
		}
	}
	return out;
}

/**
 * Half floats (older 'r16f' files), normalized 0..1 → the nearest 16-bit integer steps: a table of every half
 * (built here, only for these files), then one lookup per sample.
 */
function halvesToIntegers(raw: Uint16Array): Uint16Array {
	const table = new Uint16Array(65536);
	for (let h = 0; h < 65536; h++) table[h] = clamp(Math.round(halfToFloat(h) * 65535), 0, 65535);
	return raw.map((h) => table[h]);
}

/** IEEE 754 half → float. */
function halfToFloat(h: number): number {
	const sign = h & 0x8000 ? -1 : 1;
	const exponent = (h >> 10) & 0x1f;
	const mantissa = h & 0x3ff;
	return exponent === 0
		? sign * mantissa * 2 ** -24
		: exponent === 31
			? mantissa
				? NaN
				: sign * Infinity
			: sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}
