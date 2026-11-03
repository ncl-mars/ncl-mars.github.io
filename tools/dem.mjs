/**
 * Cuts a square heightmap out of a folder of GeoTIFF tiles (a DEM download, e.g. LINZ's 1 m DEM), anywhere
 * across the tiles, at the tiles' resolution or averaged over N × N pixels. Reads only the parts of the
 * tiles it needs, and writes a plain GeoTIFF of 32-bit floats (uncompressed, one row per strip) that
 * Houdini's File COP opens. Missing data stays -9999. The whole process: doc/dem.md.
 *
 *   node tools/dem.mjs <tiles folder> <out.tif> [--offset X Y | --center X Y] [--size S] [--step N]
 *
 * --offset: the square's centre, X metres east and Y north of the field's centre (the cut_dem.cl kernel's
 * `center` on the preview). --center: the centre in the tiles' coordinates (metres: NZTM for LINZ). Whole
 * metres. S: the square's side, in metres. Without a centre, the square is around the field's centre, the
 * largest the field holds unless --size says otherwise: the preview, with --step 8 or more.
 * Reads one band of 32-bit floats, uncompressed, LZW or Deflate (predictor 1 or 3), tiled or in strips,
 * little-endian TIFF or BigTIFF, all the tiles on one grid.
 */
import { closeSync, mkdirSync, openSync, readdirSync, readSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';

const NODATA = -9999;
const TYPE_BYTES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };
/** The tags read: size, sample format, compression, layout, georeferencing, nodata. */
const TAGS = new Set([256, 257, 258, 259, 273, 277, 278, 279, 317, 322, 323, 324, 325, 339, 33550, 33922, 34735, 42113]);

const args = process.argv.slice(2);
const center = option('--center', 2);
const offset = option('--offset', 2);
const size = option('--size', 1)?.[0];
const step = option('--step', 1)?.[0] ?? 1;
const [folder, out] = args;
if (!folder || !out || args.length > 2) {
	fail('usage: node tools/dem.mjs <tiles folder> <out.tif> [--offset X Y | --center X Y] [--size S] [--step N]');
}
if (center && offset) fail('--offset or --center, not both');
if ((center || offset) && size === undefined) fail('--size goes with --offset and --center');
if (!Number.isInteger(step) || step < 1 || step > 255) fail('--step must be a whole number from 1 to 255');

const images = readdirSync(folder)
	.filter((name) => /\.tiff?$/i.test(name))
	.map((name) => openImage(join(folder, name)));
if (images.length === 0) fail(`no .tif in ${folder}`);
const pixel = images[0].pixel;
for (const image of images) {
	if (image.pixel !== pixel) fail(`${image.name} has ${image.pixel} m pixels, ${images[0].name} ${pixel} m`);
}

// The field: the tiles' union. Its centre, on the pixel grid, is where --offset counts from.
const fieldLeft = Math.min(...images.map((image) => image.left));
const fieldTop = Math.max(...images.map((image) => image.top));
const fieldWidth = Math.max(...images.map((image) => image.left + image.width * pixel)) - fieldLeft;
const fieldHeight = fieldTop - Math.min(...images.map((image) => image.top - image.height * pixel));
const fieldX = fieldLeft + Math.floor(fieldWidth / pixel / 2) * pixel;
const fieldY = fieldTop - Math.floor(fieldHeight / pixel / 2) * pixel;

// The square: its centre and side, then its top-left corner
const [x, y] = center ?? [fieldX + (offset?.[0] ?? 0), fieldY + (offset?.[1] ?? 0)];
let side = size;
if (side === undefined) {
	// The largest the field holds around its centre, in whole steps and an even number of pixels (its
	// corners on the grid)
	const unit = step * pixel;
	side = Math.floor(Math.min(fieldWidth, fieldHeight) / unit) * unit;
	if (Math.round(side / pixel) % 2) side -= unit;
}
const left = x - side / 2;
const top = y + side / 2;
const columns = side / pixel;
if (!Number.isInteger(columns) || columns < step) fail(`--size must be a whole number of ${pixel} m pixels, at least --step of them`);
const width = Math.floor(columns / step);
const height = width;
if (width * height > 2 ** 28) fail(`${width} x ${height} px is over 1 GB: use a larger --step`);
for (const image of images) {
	const dx = (image.left - left) / pixel;
	const dy = (top - image.top) / pixel;
	if (Math.abs(dx - Math.round(dx)) > 1e-6 || Math.abs(dy - Math.round(dy)) > 1e-6) {
		fail(`${image.name} is off the window's pixel grid: the centre and size / 2 must be whole ${pixel} m pixels`);
	}
	image.dx = Math.round(dx);
	image.dy = Math.round(dy);
}

const result = new Float32Array(width * height).fill(NODATA);
const sum = step > 1 ? new Float64Array(width * height) : null;
const count = step > 1 ? new Uint16Array(width * height) : null;
for (const image of images) {
	// The part of the image inside the window, in the image's pixels
	const c0 = Math.max(0, -image.dx);
	const c1 = Math.min(image.width, width * step - image.dx);
	const r0 = Math.max(0, -image.dy);
	const r1 = Math.min(image.height, height * step - image.dy);
	if (c0 >= c1 || r0 >= r1) continue;
	process.stdout.write(`${image.name} `);
	const { tileWidth: tw, tileHeight: th, nodata } = image;
	for (let tr = Math.floor(r0 / th); tr * th < r1; tr++) {
		for (let tc = Math.floor(c0 / tw); tc * tw < c1; tc++) {
			const tile = readTile(image, tr * image.across + tc);
			if (!tile) continue;
			const ca = Math.max(c0, tc * tw);
			const cb = Math.min(c1, (tc + 1) * tw);
			for (let r = Math.max(r0, tr * th); r < Math.min(r1, (tr + 1) * th); r++) {
				const from = (r - tr * th - tc) * tw; // tile[from + c]: the image's pixel (c, r)
				const y = r + image.dy;
				if (step === 1) {
					const to = y * width + image.dx;
					for (let c = ca; c < cb; c++) {
						const v = tile[from + c];
						if (v !== nodata && v === v) result[to + c] = v;
					}
				} else {
					const to = Math.floor(y / step) * width;
					for (let c = ca; c < cb; c++) {
						const v = tile[from + c];
						if (v !== nodata && v === v) {
							const k = to + Math.floor((c + image.dx) / step);
							sum[k] += v;
							count[k]++;
						}
					}
				}
			}
		}
	}
}

let missing = 0;
let low = Infinity;
let high = -Infinity;
for (let k = 0; k < result.length; k++) {
	if (sum) result[k] = count[k] ? sum[k] / count[k] : NODATA;
	const v = result[k];
	if (v === NODATA) missing++;
	else {
		if (v < low) low = v;
		if (v > high) high = v;
	}
}
mkdirSync(dirname(out), { recursive: true });
writeTiff(out, result, width, height, { left, top, pixel: pixel * step, crs: images[0].crs });
for (const image of images) closeSync(image.fd);

const spacing = pixel * step;
console.log(`\nfield: ${fieldWidth} x ${fieldHeight} m, centre ${fieldX}, ${fieldY}`);
console.log(`square: ${side} m, centre ${x}, ${y} (offset ${x - fieldX}, ${y - fieldY})`);
console.log(`${out}: ${width} x ${height} px of ${spacing} m (${(result.byteLength / 1e6).toFixed(0)} MB)`);
if (missing === result.length) console.log('no data in the square');
else {
	const holes = missing ? `${missing} px missing (-9999): keep the square inside the field` : 'nothing missing';
	console.log(`heights ${low.toFixed(2)} .. ${high.toFixed(2)} m, ${holes}`);
}

/** Takes `--name v1 v2…` out of the arguments. */
function option(name, count) {
	const i = args.indexOf(name);
	if (i < 0) return undefined;
	const values = args.splice(i, count + 1).slice(1).map(Number);
	if (values.length !== count || !values.every(Number.isFinite)) fail(`${name} takes ${count} number${count > 1 ? 's' : ''}`);
	return values;
}

function fail(message) {
	console.error(`dem: ${message}`);
	process.exit(1);
}

/** A tile's first directory: its layout, georeferencing and nodata. The file stays open for readTile. */
function openImage(path) {
	const name = basename(path);
	const fd = openSync(path, 'r');
	const read = (offset, length) => {
		const buffer = Buffer.alloc(length);
		readSync(fd, buffer, 0, length, offset);
		return buffer;
	};
	const head = read(0, 16);
	const big = head.readUInt16LE(2) === 43;
	if (head.toString('latin1', 0, 2) !== 'II' || (!big && head.readUInt16LE(2) !== 42)) fail(`${name}: not a little-endian TIFF`);
	const at = big ? Number(head.readBigUInt64LE(8)) : head.readUInt32LE(4);
	const entry = big ? 20 : 12;
	const entries = big ? Number(read(at, 8).readBigUInt64LE(0)) : read(at, 2).readUInt16LE(0);
	const block = read(at + (big ? 8 : 2), entries * entry);
	const tags = new Map();
	for (let e = 0; e < block.length; e += entry) {
		const tag = block.readUInt16LE(e);
		if (!TAGS.has(tag)) continue;
		const type = block.readUInt16LE(e + 2);
		const n = big ? Number(block.readBigUInt64LE(e + 4)) : block.readUInt32LE(e + 4);
		const bytes = (TYPE_BYTES[type] ?? 1) * n;
		const data =
			bytes <= (big ? 8 : 4)
				? block.subarray(e + (big ? 12 : 8))
				: read(big ? Number(block.readBigUInt64LE(e + 12)) : block.readUInt32LE(e + 8), bytes);
		tags.set(tag, type === 2 ? data.toString('latin1', 0, n).replace(/\0+$/, '') : values(data, type, n));
	}
	const one = (tag, fallback) => tags.get(tag)?.[0] ?? fallback;
	if (one(258) !== 32 || one(339, 1) !== 3 || one(277, 1) !== 1) fail(`${name}: only one band of 32-bit floats is supported`);
	const compression = one(259, 1);
	if (![1, 5, 8, 32946].includes(compression)) fail(`${name}: compression ${compression} isn't supported (none, LZW, Deflate)`);
	const predictor = one(317, 1);
	if (predictor !== 1 && predictor !== 3) fail(`${name}: predictor ${predictor} isn't supported`);
	const scale = tags.get(33550);
	const tie = tags.get(33922);
	if (!scale || !tie) fail(`${name}: not georeferenced (no pixel scale or tiepoint)`);
	if (scale[0] !== scale[1]) fail(`${name}: the pixels aren't square`);
	const keys = tags.get(34735) ?? [];
	const key = (id) => {
		for (let k = 4; k + 3 < keys.length; k += 4) if (keys[k] === id && keys[k + 1] === 0) return keys[k + 3];
	};
	const half = key(1025) === 2 ? scale[0] / 2 : 0; // pixel is point: the tiepoint is a pixel's centre
	const snap = (v) => Math.round(v * 1e6) / 1e6; // exports carry float noise (1492032.0000000002)
	const tiled = tags.has(322);
	const width = one(256);
	const height = one(257);
	return {
		name,
		fd,
		width,
		height,
		tileWidth: tiled ? one(322) : width,
		tileHeight: tiled ? one(323) : Math.min(one(278, height), height),
		across: tiled ? Math.ceil(width / one(322)) : 1,
		offsets: tags.get(tiled ? 324 : 273),
		counts: tags.get(tiled ? 325 : 279),
		compression,
		predictor,
		pixel: scale[0],
		left: snap(tie[3] - tie[0] * scale[0] - half),
		top: snap(tie[4] + tie[1] * scale[1] + half),
		nodata: tags.has(42113) ? parseFloat(tags.get(42113)) : NaN,
		crs: key(3072),
	};
}

function values(b, type, n) {
	const size = TYPE_BYTES[type] ?? 1;
	const get =
		type === 3
			? (o) => b.readUInt16LE(o)
			: type === 4
				? (o) => b.readUInt32LE(o)
				: type === 16
					? (o) => Number(b.readBigUInt64LE(o))
					: type === 12
						? (o) => b.readDoubleLE(o)
						: type === 11
							? (o) => b.readFloatLE(o)
							: (o) => b[o];
	return Array.from({ length: n }, (_, k) => get(k * size));
}

/** One tile (or strip) as floats, or null when nothing is stored for it. */
function readTile(image, index) {
	const length = image.counts[index];
	if (!length) return null;
	const raw = Buffer.alloc(length);
	readSync(image.fd, raw, 0, length, image.offsets[index]);
	const bytes = image.tileWidth * image.tileHeight * 4;
	let tile;
	if (image.compression === 5) tile = lzw(raw, bytes);
	else {
		// Copied: a fresh buffer is aligned for the Float32Array (a short last strip leaves zeros)
		const data = image.compression === 1 ? raw : inflateSync(raw);
		tile = new Uint8Array(bytes);
		tile.set(data.subarray(0, bytes));
	}
	if (image.predictor === 3) unpredict(tile, image.tileWidth, image.tileHeight);
	return new Float32Array(tile.buffer, 0, bytes / 4);
}

/** TIFF's LZW: codes of 9 to 12 bits, most significant bit first, each width starting one code early. */
function lzw(input, length) {
	const out = new Uint8Array(length);
	const data = new Uint8Array(input.length + 4); // padded: reading the last code looks past the end
	data.set(input);
	const prefix = new Int16Array(4096).fill(-1);
	const suffix = new Uint8Array(4096);
	const first = new Uint8Array(4096);
	const size = new Uint16Array(4096);
	for (let i = 0; i < 256; i++) {
		suffix[i] = first[i] = i;
		size[i] = 1;
	}
	const end = input.length * 8;
	let bit = 0;
	let width = 9;
	let next = 258;
	let old = -1;
	let o = 0;
	while (bit + width <= end) {
		const p = bit >>> 3;
		const code = (((data[p] << 16) | (data[p + 1] << 8) | data[p + 2]) >>> (24 - (bit & 7) - width)) & ((1 << width) - 1);
		bit += width;
		if (code === 257) break; // end of information
		if (code === 256) {
			// clear
			width = 9;
			next = 258;
			old = -1;
			continue;
		}
		if (old < 0) {
			if (o < length) out[o++] = code;
			old = code;
			continue;
		}
		if (code > next) break; // corrupt
		const known = code < next;
		const c = known ? code : old;
		const n = size[c];
		if (o + n + (known ? 0 : 1) > length) break; // more than the tile holds: corrupt
		for (let t = c, k = o + n - 1; t >= 0; t = prefix[t]) out[k--] = suffix[t];
		o += n;
		if (!known) out[o++] = first[old];
		if (next < 4096) {
			prefix[next] = old;
			suffix[next] = first[c];
			first[next] = first[old];
			size[next] = size[old] + 1;
			next++;
			if (next === (1 << width) - 1 && width < 12) width++;
		}
		old = code;
	}
	return out;
}

/**
 * Predictor 3 (floating point): each row holds its samples' bytes plane by plane, most significant first,
 * each byte stored as the difference from the previous one. Back to little-endian floats.
 */
function unpredict(tile, samples, rows) {
	const rowBytes = samples * 4;
	const row = new Uint8Array(rowBytes);
	for (let r = 0; r < rows; r++) {
		const o = r * rowBytes;
		for (let k = o + 1; k < o + rowBytes; k++) tile[k] += tile[k - 1];
		row.set(tile.subarray(o, o + rowBytes));
		for (let s = 0; s < samples; s++) {
			for (let b = 0; b < 4; b++) tile[o + s * 4 + b] = row[(3 - b) * samples + s];
		}
	}
}

/** A GeoTIFF of 32-bit floats: uncompressed, one row per strip, the rows after the header. */
function writeTiff(path, pixels, width, height, geo) {
	const rowBytes = width * 4;
	const filled = (bytes, write) => {
		const buffer = Buffer.alloc(bytes);
		write(buffer);
		return buffer;
	};
	const doubles = (list) => filled(list.length * 8, (b) => list.forEach((v, k) => b.writeDoubleLE(v, k * 8)));
	const shorts = (list) => filled(list.length * 2, (b) => list.forEach((v, k) => b.writeUInt16LE(v, k * 2)));
	const offsets = Buffer.alloc(height * 4);
	const counts = filled(height * 4, (b) => {
		for (let r = 0; r < height; r++) b.writeUInt32LE(rowBytes, r * 4);
	});
	// [tag, type, count, value], in tag order: a number goes in the entry, a Buffer after the directory
	// (in the entry when it fits in 4 bytes)
	const entries = [
		[256, 4, 1, width],
		[257, 4, 1, height],
		[258, 3, 1, 32], // bits per sample
		[259, 3, 1, 1], // no compression
		[262, 3, 1, 1], // black is zero
		[273, 4, height, offsets], // strip offsets
		[277, 3, 1, 1], // samples per pixel
		[278, 4, 1, 1], // rows per strip
		[279, 4, height, counts], // strip byte counts
		[284, 3, 1, 1], // planar configuration: contiguous
		[339, 3, 1, 3], // sample format: float
		[33550, 12, 3, doubles([geo.pixel, geo.pixel, 0])], // pixel scale
		[33922, 12, 6, doubles([0, 0, 0, geo.left, geo.top, 0])], // tiepoint: the top-left corner
	];
	if (geo.crs) entries.push([34735, 3, 16, shorts([1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, geo.crs])]);
	entries.push([42113, 2, String(NODATA).length + 1, Buffer.from(`${NODATA}\0`, 'latin1')]); // GDAL's nodata

	let end = 8 + 2 + entries.length * 12 + 4;
	const placed = entries.map(([, , , value]) => {
		if (!Buffer.isBuffer(value) || value.length <= 4) return 0;
		const at = Math.ceil(end / 8) * 8;
		end = at + value.length;
		return at;
	});
	const start = Math.ceil(end / 8) * 8; // the rows
	if (start + height * rowBytes > 2 ** 32) fail(`${path}: over 4 GB`);
	for (let r = 0; r < height; r++) offsets.writeUInt32LE(start + r * rowBytes, r * 4);

	const head = Buffer.alloc(start);
	head.write('II', 0, 'latin1');
	head.writeUInt16LE(42, 2);
	head.writeUInt32LE(8, 4);
	head.writeUInt16LE(entries.length, 8);
	entries.forEach(([tag, type, n, value], k) => {
		const e = 10 + k * 12;
		head.writeUInt16LE(tag, e);
		head.writeUInt16LE(type, e + 2);
		head.writeUInt32LE(n, e + 4);
		if (!Buffer.isBuffer(value)) {
			if (type === 3) head.writeUInt16LE(value, e + 8);
			else head.writeUInt32LE(value, e + 8);
		} else if (placed[k]) {
			head.writeUInt32LE(placed[k], e + 8);
			value.copy(head, placed[k]);
		} else value.copy(head, e + 8);
	});

	const fd = openSync(path, 'w');
	writeAll(fd, head);
	writeAll(fd, new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength));
	closeSync(fd);
}

function writeAll(fd, bytes) {
	for (let p = 0; p < bytes.length; ) p += writeSync(fd, bytes, p, Math.min(bytes.length - p, 1 << 26));
}
