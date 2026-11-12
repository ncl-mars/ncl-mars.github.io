/**
 * Procedural noise textures, generated once per GL context (cache them with `renderer.resource`), for
 * shaders that need smooth noise cheaply: one texture fetch instead of hashing lattice corners, and no
 * blocky value-noise cells.
 * - 3D noise: 64³ RGBA8, four independent tileable gradient (Perlin) noises, 8 lattice cells per tile,
 *   REPEAT + LINEAR + mipmaps. In GLSL, sample with `p / 8.0` where p is in noise cells; mean ≈ 0.5.
 * - Hash: 256² RGBA8 white noise, REPEAT + NEAREST, for per-cell random values (`texelFetch`).
 * - Blue noise: 64² R8, REPEAT + NEAREST, values spread evenly with no clumps or gaps (void-and-cluster), for
 *   per-pixel offsets: `texelFetch(…, ivec2(gl_FragCoord.xy) % 64, 0).r`. Few samples then read as an even,
 *   fine grain instead of a pattern.
 */

const NOISE_CELLS = 8;

export function createNoiseTexture3D(gl: WebGL2RenderingContext, size = 64): WebGLTexture {
	const channels = [11, 23, 37, 53].map((seed) => tileableGradientNoise(size, NOISE_CELLS, seed));
	const data = new Uint8Array(size * size * size * 4);
	for (let c = 0; c < 4; c++) {
		const values = channels[c];
		let lo = Infinity;
		let hi = -Infinity;
		for (const v of values) {
			lo = Math.min(lo, v);
			hi = Math.max(hi, v);
		}
		for (let k = 0; k < values.length; k++) data[k * 4 + c] = Math.round(((values[k] - lo) / (hi - lo)) * 255);
	}

	const texture = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_3D, texture);
	gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, size, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
	gl.generateMipmap(gl.TEXTURE_3D);
	gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
	gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
	gl.bindTexture(gl.TEXTURE_3D, null);
	return texture;
}

export function createHashTexture(gl: WebGL2RenderingContext, size = 256): WebGLTexture {
	const rand = mulberry32(97);
	const data = new Uint8Array(size * size * 4);
	for (let k = 0; k < data.length; k++) data[k] = Math.floor(rand() * 256);
	const texture = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	gl.bindTexture(gl.TEXTURE_2D, null);
	return texture;
}

export function createBlueNoiseTexture(gl: WebGL2RenderingContext, size = 64): WebGLTexture {
	const texture = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, size, size, 0, gl.RED, gl.UNSIGNED_BYTE, blueNoise(size, 7));
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	gl.bindTexture(gl.TEXTURE_2D, null);
	return texture;
}

/**
 * Blue noise by void-and-cluster (Ulichney, 1993), tileable: every pixel gets a rank, 0 to size² − 1, such that
 * the pixels under any threshold are spread as evenly as possible. Energy is a Gaussian (σ 1.5 pixels, cut at
 * 3σ) summed over the chosen pixels, wrapping around the tile. Ranks out as bytes, 0..255, evenly used.
 */
function blueNoise(size: number, seed: number): Uint8Array {
	const n = size * size;
	const sigma = 1.5;
	const radius = Math.ceil(3 * sigma);
	const dx: number[] = [];
	const dy: number[] = [];
	const weights: number[] = [];
	for (let y = -radius; y <= radius; y++) {
		for (let x = -radius; x <= radius; x++) {
			dx.push(x);
			dy.push(y);
			weights.push(Math.exp(-(x * x + y * y) / (2 * sigma * sigma)));
		}
	}
	/** Add (sign 1) or remove (−1) pixel i's Gaussian to an energy map. */
	const splat = (energy: Float32Array, i: number, sign: number) => {
		const x = i % size;
		const y = (i - x) / size;
		for (let k = 0; k < weights.length; k++) {
			energy[((y + dy[k] + size) % size) * size + ((x + dx[k] + size) % size)] += sign * weights[k];
		}
	};
	/** The pixel whose `pattern` is `value` with the highest energy (`highest`), or the lowest. */
	const find = (energy: Float32Array, pattern: Uint8Array, value: number, highest: boolean) => {
		let best = -1;
		let bestEnergy = highest ? -Infinity : Infinity;
		for (let i = 0; i < n; i++) {
			if (pattern[i] !== value) continue;
			const e = energy[i];
			if (highest ? e > bestEnergy : e < bestEnergy) {
				bestEnergy = e;
				best = i;
			}
		}
		return best;
	};

	// A few random points (a tenth), then spread: move the tightest cluster's point to the largest void until
	// that changes nothing
	const rand = mulberry32(seed);
	const pattern = new Uint8Array(n);
	const energy = new Float32Array(n);
	const initial = Math.round(n / 10);
	for (let placed = 0; placed < initial; ) {
		const i = Math.floor(rand() * n);
		if (pattern[i]) continue;
		pattern[i] = 1;
		splat(energy, i, 1);
		placed++;
	}
	for (let pass = 0; pass < n; pass++) {
		const cluster = find(energy, pattern, 1, true);
		pattern[cluster] = 0;
		splat(energy, cluster, -1);
		const hole = find(energy, pattern, 0, false);
		pattern[hole] = 1;
		splat(energy, hole, 1);
		if (hole === cluster) break;
	}

	const rank = new Uint32Array(n);
	// 1. The initial points, tightest cluster last: removed one by one, ranked downward
	{
		const p = pattern.slice();
		const e = energy.slice();
		for (let ones = initial; ones > 0; ) {
			const cluster = find(e, p, 1, true);
			p[cluster] = 0;
			splat(e, cluster, -1);
			rank[cluster] = --ones;
		}
	}
	// 2. Up to half: each new point in the largest void
	let ones = initial;
	while (ones < n / 2) {
		const hole = find(energy, pattern, 0, false);
		pattern[hole] = 1;
		splat(energy, hole, 1);
		rank[hole] = ones++;
	}
	// 3. The rest: the empty pixels are the minority now; fill their tightest cluster first
	const empty = new Float32Array(n);
	for (let i = 0; i < n; i++) if (!pattern[i]) splat(empty, i, 1);
	while (ones < n) {
		const cluster = find(empty, pattern, 0, true);
		pattern[cluster] = 1;
		splat(empty, cluster, -1);
		rank[cluster] = ones++;
	}

	const out = new Uint8Array(n);
	for (let i = 0; i < n; i++) out[i] = Math.floor((rank[i] * 256) / n);
	return out;
}

/** Perlin gradient noise over a size³ grid, periodic: `cells` lattice cells per tile on each axis. */
function tileableGradientNoise(size: number, cells: number, seed: number): Float32Array {
	const rand = mulberry32(seed);
	const gradients = new Float32Array(cells * cells * cells * 3);
	for (let k = 0; k < cells * cells * cells; k++) {
		let x: number, y: number, z: number, l: number;
		do {
			x = rand() * 2 - 1;
			y = rand() * 2 - 1;
			z = rand() * 2 - 1;
			l = Math.hypot(x, y, z);
		} while (l > 1 || l < 1e-3);
		gradients.set([x / l, y / l, z / l], k * 3);
	}
	const corner = (ix: number, iy: number, iz: number, fx: number, fy: number, fz: number) => {
		const k = (((iz % cells) * cells + (iy % cells)) * cells + (ix % cells)) * 3;
		return gradients[k] * fx + gradients[k + 1] * fy + gradients[k + 2] * fz;
	};
	const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
	const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

	const out = new Float32Array(size * size * size);
	const step = cells / size;
	for (let z = 0; z < size; z++) {
		const pz = (z + 0.5) * step;
		const iz = Math.floor(pz);
		const fz = pz - iz;
		const wz = fade(fz);
		for (let y = 0; y < size; y++) {
			const py = (y + 0.5) * step;
			const iy = Math.floor(py);
			const fy = py - iy;
			const wy = fade(fy);
			for (let x = 0; x < size; x++) {
				const px = (x + 0.5) * step;
				const ix = Math.floor(px);
				const fx = px - ix;
				const wx = fade(fx);
				const x00 = lerp(corner(ix, iy, iz, fx, fy, fz), corner(ix + 1, iy, iz, fx - 1, fy, fz), wx);
				const x10 = lerp(corner(ix, iy + 1, iz, fx, fy - 1, fz), corner(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz), wx);
				const x01 = lerp(corner(ix, iy, iz + 1, fx, fy, fz - 1), corner(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1), wx);
				const x11 = lerp(
					corner(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1),
					corner(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1),
					wx
				);
				out[(z * size + y) * size + x] = lerp(lerp(x00, x10, wy), lerp(x01, x11, wy), wz);
			}
		}
	}
	return out;
}

function mulberry32(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
