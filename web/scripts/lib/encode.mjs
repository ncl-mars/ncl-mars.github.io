// File encoders shared by the generator scripts (no dependencies): IEEE half floats and 8-bit RGB PNG.

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/** float32 → IEEE 754 half (round to nearest). */
export function floatToHalf(value) {
	const f32 = new Float32Array([value]);
	const x = new Uint32Array(f32.buffer)[0];
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

/** Write floats as little-endian half floats (the .bin formats in doc/formats/). */
export function writeHalfFloats(path, values) {
	const view = new DataView(new ArrayBuffer(values.length * 2));
	for (let k = 0; k < values.length; k++) view.setUint16(k * 2, floatToHalf(values[k]), true);
	writeFileSync(path, new Uint8Array(view.buffer));
}

/** Minimal 8-bit RGB PNG encoder ("Up" filter on every row). `pixels`: width × height × 3 bytes. */
export function writePng(path, width, height, pixels) {
	const stride = width * 3;
	const filtered = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		const row = y * (stride + 1);
		filtered[row] = 2;
		for (let x = 0; x < stride; x++) {
			const above = y > 0 ? pixels[(y - 1) * stride + x] : 0;
			filtered[row + 1 + x] = (pixels[y * stride + x] - above) & 0xff;
		}
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // bit depth
	header[9] = 2; // colour type: RGB
	writeFileSync(
		path,
		Buffer.concat([
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
			pngChunk('IHDR', header),
			pngChunk('IDAT', deflateSync(filtered, { level: 9 })),
			pngChunk('IEND', Buffer.alloc(0))
		])
	);
}

function pngChunk(type, data) {
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const out = Buffer.alloc(body.length + 8);
	out.writeUInt32BE(data.length, 0);
	body.copy(out, 4);
	out.writeUInt32BE(crc32(body), body.length + 4);
	return out;
}

function crc32(bytes) {
	let c = 0xffffffff;
	for (const b of bytes) {
		c ^= b;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	}
	return (c ^ 0xffffffff) >>> 0;
}
