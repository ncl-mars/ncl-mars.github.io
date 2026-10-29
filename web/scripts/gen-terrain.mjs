// Placeholder terrain for the dig site, used until the real Houdini export exists.
// Writes, in src/lib/assets/terrain/:
//   heightmap.bin + heightmap.json   (doc/formats/heightmap.md)
//   maps.png + maps.json             (doc/formats/terrain-maps.md: R light + soft shadows, G AO, B cavity)
//
// Usage, from web/:  npm run gen:terrain [-- --force] [-- --size 1024 --seed 7]
// Existing files are never overwritten without --force: they may be a real export.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeHalfFloats, writePng } from './lib/encode.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? Number(args[i + 1]) : fallback;
};
const SIZE = option('size', 1024);
const SEED = option('seed', 7);
const FORCE = args.includes('--force');

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/lib/assets/terrain');
const FILES = ['heightmap.bin', 'heightmap.json', 'maps.png', 'maps.json'].map((f) => join(OUT, f));

// World box: x/z are the outer edges of the sample grid, y is the height range (data is normalized into it)
const BOUNDS = { min: [-500, 0, -500], max: [500, 70, 500] };
// Toward the sun: low (≈20°) and from the west, raking across the north-facing survey view
const SUN_DIR = normalize([-0.8, 0.34, 0.35]);

if (!FORCE && FILES.some((f) => existsSync(f))) {
	console.log('Terrain files already exist (maybe a real export). Use --force to overwrite.');
	process.exit(0);
}

const N = SIZE;
const CELL = (BOUNDS.max[0] - BOUNDS.min[0]) / N; // world units per sample (square grid)
const HEIGHT_RANGE = BOUNDS.max[1] - BOUNDS.min[1];
let time = performance.now();
const step = (label) => {
	const now = performance.now();
	console.log(`${label.padEnd(12)} ${((now - time) / 1000).toFixed(2)} s`);
	time = now;
};

// --- heightmap ----------------------------------------------------------------------------------

const raw = new Float32Array(N * N);
for (let j = 0; j < N; j++) {
	for (let i = 0; i < N; i++) {
		const x = BOUNDS.min[0] + (i + 0.5) * CELL;
		const z = BOUNDS.min[2] + (j + 0.5) * CELL;
		raw[j * N + i] = terrainShape(x, z);
	}
}
let lo = Infinity;
let hi = -Infinity;
for (const v of raw) {
	lo = Math.min(lo, v);
	hi = Math.max(hi, v);
}
const normalized = raw.map((v) => (v - lo) / (hi - lo));
const heights = normalized.map((v) => BOUNDS.min[1] + v * HEIGHT_RANGE); // world units, for the maps
step('heightmap');

// --- maps ---------------------------------------------------------------------------------------

const at = (i, j) => heights[clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)];
const bilinear = (u, v) => {
	const i = Math.floor(u);
	const j = Math.floor(v);
	const fu = u - i;
	const fv = v - j;
	return lerp(lerp(at(i, j), at(i + 1, j), fu), lerp(at(i, j + 1), at(i + 1, j + 1), fu), fv);
};
const maxHeight = BOUNDS.max[1];

const light = new Float32Array(N * N);
const sunXZ = Math.hypot(SUN_DIR[0], SUN_DIR[2]);
const sunStep = [SUN_DIR[0] / sunXZ, SUN_DIR[2] / sunXZ]; // one texel along the sun's ground direction
const sunRise = (SUN_DIR[1] / sunXZ) * CELL; // ray climb per texel
for (let j = 0; j < N; j++) {
	for (let i = 0; i < N; i++) {
		const n = normalize([
			-(at(i + 1, j) - at(i - 1, j)) / (2 * CELL),
			1,
			-(at(i, j + 1) - at(i, j - 1)) / (2 * CELL)
		]);
		const ndl = Math.max(0, dot(n, SUN_DIR));
		// Soft shadow: march toward the sun, keep the smallest clearance / distance ratio
		const h0 = at(i, j) + 0.05;
		let shadow = 1;
		for (let s = 1; ; s += Math.max(1, s * 0.04)) {
			const u = i + sunStep[0] * s;
			const v = j + sunStep[1] * s;
			if (u < 0 || v < 0 || u > N - 1 || v > N - 1) break;
			const rayHeight = h0 + sunRise * s;
			if (rayHeight > maxHeight) break;
			const clearance = rayHeight - bilinear(u, v);
			if (clearance <= 0) {
				shadow = 0;
				break;
			}
			shadow = Math.min(shadow, (10 * clearance) / (s * CELL));
		}
		light[j * N + i] = ndl * smoothstep(0, 1, shadow);
	}
}
step('light');

// Ambient occlusion: horizon angle in 8 directions, samples at 1..64 texels
const ao = new Float32Array(N * N);
const directions = Array.from({ length: 8 }, (_, k) => [
	Math.cos((k * Math.PI) / 4),
	Math.sin((k * Math.PI) / 4)
]);
for (let j = 0; j < N; j++) {
	for (let i = 0; i < N; i++) {
		const h0 = at(i, j);
		let occlusion = 0;
		for (const [dx, dz] of directions) {
			let maxSlope = 0;
			for (let d = 1; d <= 64; d *= 2) {
				const slope = (bilinear(i + dx * d, j + dz * d) - h0) / (d * CELL);
				maxSlope = Math.max(maxSlope, slope);
			}
			occlusion += Math.sin(Math.atan(maxSlope));
		}
		ao[j * N + i] = clamp(1 - (occlusion / directions.length) * 1.6, 0, 1);
	}
}
step('ao');

// Cavity: height minus its local average (box blur, radius 3), mapped around 0.5
const blurred = boxBlur(boxBlur(heights, 3, true), 3, false);
const detail = heights.map((h, k) => h - blurred[k]);
let meanAbs = 0;
for (const d of detail) meanAbs += Math.abs(d);
meanAbs /= detail.length;
const cavity = detail.map((d) => 0.5 + 0.5 * clamp(d / (meanAbs * 4), -1, 1));
step('cavity');

// --- write --------------------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });

writeHalfFloats(join(OUT, 'heightmap.bin'), normalized);
writeJson('heightmap.json', { version: 1, width: N, height: N, format: 'r16f', bounds: BOUNDS });

const rgb = new Uint8Array(N * N * 3);
for (let k = 0; k < N * N; k++) {
	rgb[k * 3] = Math.round(light[k] * 255);
	rgb[k * 3 + 1] = Math.round(ao[k] * 255);
	rgb[k * 3 + 2] = Math.round(cavity[k] * 255);
}
writePng(join(OUT, 'maps.png'), N, N, rgb);
writeJson('maps.json', { version: 1, sunDir: SUN_DIR.map((v) => Number(v.toFixed(5))) });
step('write');
console.log(`Wrote ${N}×${N} terrain to ${OUT}`);

// --- terrain shape -------------------------------------------------------------------------------

function terrainShape(x, z) {
	const f = 1 / 400; // base feature size ≈ 400 world units
	const wx = fbm(x * f * 0.7 + 3.1, z * f * 0.7 - 1.7, 3) * 120; // domain warp
	const wz = fbm(x * f * 0.7 - 5.3, z * f * 0.7 + 2.9, 3) * 120;
	const px = (x + wx) * f;
	const pz = (z + wz) * f;
	let h = fbm(px, pz, 6) * 0.6 + ridged(px * 1.6, pz * 1.6, 5) * 0.45;
	// The dig site: a gentle, almost flat plateau around the centre, where the grid will sit
	const plateau = 1 - smoothstep(0.6, 1.0, Math.hypot(x, z) / 180);
	const level = 0.22 + fbm(x * 0.02, z * 0.02, 3) * 0.03;
	return lerp(h, level, plateau * 0.85);
}

function hash(ix, iy) {
	let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(SEED, 1274126177);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Gradient noise, roughly in [-0.7, 0.7]
function noise(x, y) {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const fx = x - ix;
	const fy = y - iy;
	const g = (cx, cy, dx, dy) => {
		const a = hash(cx, cy) * Math.PI * 2;
		return Math.cos(a) * dx + Math.sin(a) * dy;
	};
	const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
	const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
	return lerp(
		lerp(g(ix, iy, fx, fy), g(ix + 1, iy, fx - 1, fy), u),
		lerp(g(ix, iy + 1, fx, fy - 1), g(ix + 1, iy + 1, fx - 1, fy - 1), u),
		v
	);
}

function fbm(x, y, octaves) {
	let sum = 0;
	let amp = 0.5;
	for (let o = 0; o < octaves; o++) {
		sum += noise(x, y) * amp;
		[x, y] = [x * 1.6 - y * 1.2 + 17.3, x * 1.2 + y * 1.6 - 9.1]; // rotate + scale ×2
		amp *= 0.5;
	}
	return sum;
}

function ridged(x, y, octaves) {
	let sum = 0;
	let amp = 0.5;
	let weight = 1;
	for (let o = 0; o < octaves; o++) {
		let r = 1 - Math.abs(noise(x, y) * 1.4);
		r *= r * weight;
		weight = clamp(r * 2, 0, 1);
		sum += r * amp;
		[x, y] = [x * 1.6 - y * 1.2 + 31.7, x * 1.2 + y * 1.6 + 4.3];
		amp *= 0.5;
	}
	return sum;
}

// --- helpers ------------------------------------------------------------------------------------

function boxBlur(src, radius, horizontal) {
	const out = new Float32Array(src.length);
	for (let j = 0; j < N; j++) {
		for (let i = 0; i < N; i++) {
			let sum = 0;
			for (let k = -radius; k <= radius; k++) {
				sum += horizontal
					? src[j * N + clamp(i + k, 0, N - 1)]
					: src[clamp(j + k, 0, N - 1) * N + i];
			}
			out[j * N + i] = sum / (2 * radius + 1);
		}
	}
	return out;
}

function writeJson(name, data) {
	writeFileSync(join(OUT, name), JSON.stringify(data, null, '\t') + '\n');
}

function normalize(v) {
	const l = Math.hypot(...v);
	return v.map((c) => c / l);
}
function dot(a, b) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function clamp(v, a, b) {
	return Math.min(b, Math.max(a, v));
}
function lerp(a, b, t) {
	return a + (b - a) * t;
}
function smoothstep(a, b, v) {
	const t = clamp((v - a) / (b - a), 0, 1);
	return t * t * (3 - 2 * t);
}
