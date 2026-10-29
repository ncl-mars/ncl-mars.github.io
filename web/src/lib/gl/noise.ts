/**
 * Procedural noise textures, generated once per GL context (cache them with `renderer.resource`), for
 * shaders that need smooth noise cheaply: one texture fetch instead of hashing lattice corners, and no
 * blocky value-noise cells.
 * - 3D noise: 64³ RGBA8, four independent tileable gradient (Perlin) noises, 8 lattice cells per tile,
 *   REPEAT + LINEAR + mipmaps. In GLSL, sample with `p / 8.0` where p is in noise cells; mean ≈ 0.5.
 * - Hash: 256² RGBA8 white noise, REPEAT + NEAREST, for per-cell random values (`texelFetch`).
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
