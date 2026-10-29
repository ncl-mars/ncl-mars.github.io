// Placeholder project for the core viewer prototype (/lab/core): five "render-like" colour images (lit
// spheres and discs on a gradient, different aspect ratios) with their exact relief maps
// (doc/formats/relief.md), until real images and Houdini depth maps exist.
// Writes, in src/lib/assets/lab/core/:  image-N.png, image-N.relief.bin, image-N.relief.json
//
// Usage, from web/:  npm run gen:lab-core [-- --force]

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeHalfFloats, writePng } from './lib/encode.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/lib/assets/lab/core');
const FORCE = process.argv.includes('--force');
const IMAGES = [
	{ name: 'image-1', aspect: 3 / 2, seed: 11 },
	{ name: 'image-2', aspect: 4 / 3, seed: 23 },
	{ name: 'image-3', aspect: 1, seed: 37 },
	{ name: 'image-4', aspect: 2 / 3, seed: 41 },
	{ name: 'image-5', aspect: 16 / 9, seed: 59 }
];
const COLOUR_LONG_SIDE = 1200; // lightbox image
const RELIEF_LONG_SIDE = 384; // relief map
const PALETTE = [
	[0.86, 0.36, 0.24],
	[0.95, 0.74, 0.3],
	[0.28, 0.52, 0.8],
	[0.42, 0.72, 0.5],
	[0.78, 0.48, 0.74],
	[0.92, 0.9, 0.84]
];

if (!FORCE && existsSync(join(OUT, 'image-1.png'))) {
	console.log('Lab core images already exist. Use --force to overwrite.');
	process.exit(0);
}
mkdirSync(OUT, { recursive: true });

for (const { name, aspect, seed } of IMAGES) {
	const width = aspect >= 1 ? COLOUR_LONG_SIDE : Math.round(COLOUR_LONG_SIDE * aspect);
	const height = aspect >= 1 ? Math.round(COLOUR_LONG_SIDE / aspect) : COLOUR_LONG_SIDE;
	const { rgb, depth } = renderScene(width, height, seed);
	writePng(join(OUT, `${name}.png`), width, height, rgb);

	const rw = aspect >= 1 ? RELIEF_LONG_SIDE : Math.round(RELIEF_LONG_SIDE * aspect);
	const rh = aspect >= 1 ? Math.round(RELIEF_LONG_SIDE / aspect) : RELIEF_LONG_SIDE;
	writeHalfFloats(join(OUT, `${name}.relief.bin`), downsample(depth, width, height, rw, rh));
	writeFileSync(
		join(OUT, `${name}.relief.json`),
		JSON.stringify({ version: 1, width: rw, height: rh, format: 'r16f' }, null, '\t') + '\n'
	);
	console.log(`${name}: ${width}×${height}, relief ${rw}×${rh}`);
}

/** Lit spheres and discs over a gradient; depth = shape height (near = 1), normalized. Row 0 = top. */
function renderScene(width, height, seed) {
	const rand = mulberry32(seed);
	const unit = Math.min(width, height);
	const shapes = Array.from({ length: 6 + Math.floor(rand() * 4) }, () => ({
		x: rand() * width,
		y: (0.1 + rand() * 0.85) * height,
		r: (0.08 + rand() * 0.2) * unit,
		disc: rand() < 0.35,
		colour: PALETTE[Math.floor(rand() * PALETTE.length)]
	}));

	const h = new Float32Array(width * height);
	const id = new Int16Array(width * height).fill(-1);
	for (let py = 0; py < height; py++) {
		for (let px = 0; px < width; px++) {
			const k = py * width + px;
			h[k] = 0.04 * (py / height); // background: a gentle ramp toward the viewer
			shapes.forEach((s, i) => {
				const d = Math.hypot(px - s.x, py - s.y);
				if (d >= s.r) return;
				const t = d / s.r;
				const sh = s.disc ? 0.45 * smoothstep(1, 0.85, t) : Math.sqrt(1 - t * t); // flat-top disc or sphere
				const hh = sh * s.r / unit + 0.05;
				if (hh > h[k]) {
					h[k] = hh;
					id[k] = i;
				}
			});
		}
	}

	const light = normalize([-0.55, -0.6, 0.6]); // from the top left (image y points down)
	const rgb = new Uint8Array(width * height * 3);
	let max = 0;
	for (const v of h) max = Math.max(max, v);
	const depth = new Float32Array(width * height);
	for (let py = 0; py < height; py++) {
		for (let px = 0; px < width; px++) {
			const k = py * width + px;
			const at = (x, y) => h[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
			const n = normalize([
				-(at(px + 1, py) - at(px - 1, py)) * unit * 0.5,
				-(at(px, py + 1) - at(px, py - 1)) * unit * 0.5,
				1
			]);
			const diffuse = Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
			const shape = id[k] >= 0 ? shapes[id[k]] : null;
			const base = shape
				? shape.colour
				: [0.16 + 0.2 * (py / height), 0.2 + 0.16 * (py / height), 0.26 + 0.08 * (py / height)];
			const shade = shape ? 0.22 + 0.78 * diffuse + Math.pow(diffuse, 40) * 0.5 : 1;
			for (let c = 0; c < 3; c++) rgb[k * 3 + c] = Math.round(Math.min(1, base[c] * shade) * 255);
			depth[k] = h[k] / max;
		}
	}
	return { rgb, depth };
}

function downsample(src, sw, sh, dw, dh) {
	const out = new Float32Array(dw * dh);
	for (let y = 0; y < dh; y++) {
		for (let x = 0; x < dw; x++) {
			const x0 = Math.floor((x * sw) / dw);
			const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / dw));
			const y0 = Math.floor((y * sh) / dh);
			const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / dh));
			let sum = 0;
			for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += src[yy * sw + xx];
			out[y * dw + x] = sum / ((x1 - x0) * (y1 - y0));
		}
	}
	return out;
}

function mulberry32(seed) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function normalize(v) {
	const l = Math.hypot(...v);
	return v.map((c) => c / l);
}

function smoothstep(a, b, v) {
	const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
	return t * t * (3 - 2 * t);
}
