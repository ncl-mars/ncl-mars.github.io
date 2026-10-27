/**
 * CPU copy of the terrain heightmap (format: doc/formats/heightmap.md). Used for everything the CPU needs
 * to know about the ground: camera following and collision now, picking later. Sampling matches the GPU's
 * LINEAR + CLAMP_TO_EDGE filtering, so the CPU and the shader agree on the height.
 */

export type Vec3 = [number, number, number];

export interface HeightmapMeta {
	version: 1;
	width: number;
	height: number;
	format: 'r16f';
	bounds: { min: Vec3; max: Vec3 };
}

export interface TerrainMapsMeta {
	version: 1;
	/** Unit vector toward the sun, as used for the bake. */
	sunDir: Vec3;
}

export class Heightfield {
	/** World heights, row-major (index = j * width + i, i along +X, j along +Z). */
	readonly heights: Float32Array;

	constructor(
		readonly meta: HeightmapMeta,
		/** Raw half floats, ready for the R16F texture upload. */
		readonly half: Uint16Array
	) {
		const { min, max } = meta.bounds;
		const range = max[1] - min[1];
		this.heights = new Float32Array(half.length);
		for (let k = 0; k < half.length; k++) this.heights[k] = min[1] + HALF_TO_FLOAT[half[k]] * range;
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

	/**
	 * First point where a ray meets the ground, or null (picking, grab-to-pan). Fixed steps across the
	 * terrain's box, then bisection: precise enough for input, cheap enough for pointer events.
	 */
	raycast(origin: Vec3, direction: Vec3, steps = 256): Vec3 | null {
		const { min, max } = this.meta.bounds;
		let enter = 0;
		let exit = Infinity;
		for (let axis = 0; axis < 3; axis++) {
			if (direction[axis] === 0) {
				if (origin[axis] < min[axis] || origin[axis] > max[axis]) return null;
				continue;
			}
			const t0 = (min[axis] - origin[axis]) / direction[axis];
			const t1 = (max[axis] - origin[axis]) / direction[axis];
			enter = Math.max(enter, Math.min(t0, t1));
			exit = Math.min(exit, Math.max(t0, t1));
		}
		if (enter >= exit) return null;

		const below = (t: number) =>
			origin[1] + direction[1] * t <= this.heightAt(origin[0] + direction[0] * t, origin[2] + direction[2] * t);
		const dt = (exit - enter) / steps;
		let above = enter;
		for (let i = 1; i <= steps; i++) {
			const t = enter + dt * i;
			if (below(t)) {
				let a = above;
				let b = t;
				for (let k = 0; k < 20; k++) {
					const m = (a + b) / 2;
					if (below(m)) b = m;
					else a = m;
				}
				const hit = (a + b) / 2;
				return [origin[0] + direction[0] * hit, origin[1] + direction[1] * hit, origin[2] + direction[2] * hit];
			}
			above = t;
		}
		return null;
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

/** Validate heightmap.json; throws with a clear message instead of rendering garbage. */
export function parseHeightmapMeta(json: unknown): HeightmapMeta {
	const m = json as Partial<HeightmapMeta>;
	if (m?.version !== 1) throw new Error(`heightmap.json: unsupported version ${m?.version}`);
	if (m.format !== 'r16f') throw new Error(`heightmap.json: unsupported format ${m.format}`);
	if (!(Number(m.width) > 0 && Number(m.height) > 0)) throw new Error('heightmap.json: bad width/height');
	if (!isVec3(m.bounds?.min) || !isVec3(m.bounds?.max)) throw new Error('heightmap.json: bad bounds');
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
