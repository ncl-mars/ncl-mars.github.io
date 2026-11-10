/**
 * Colour spaces. The panel's colours are display values (sRGB, picked as seen); the shaders light and fog in
 * linear light, so colours are converted on upload, and every pass that writes to the screen ends with
 * /tonemap's display() (exposure, tone curve, sRGB encode). `display` below mirrors it, for the page background.
 */

/** sRGB display values to linear light, into `out`. */
export function srgbToLinear(c: ArrayLike<number>, out = new Float32Array(3)): Float32Array {
	for (let i = 0; i < 3; i++) {
		const v = c[i];
		out[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	}
	return out;
}

/** Mirror of /tonemap's display(): a scene-linear colour to display values (sRGB, 0..1). */
export function display(c: ArrayLike<number>, exposure: number, curve: number): number[] {
	let rgb = [c[0] * exposure, c[1] * exposure, c[2] * exposure];
	if (curve > 1.5) rgb = rgb.map((x) => clamp01((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
	else if (curve > 0.5) rgb = toneAgx(rgb);
	else rgb = toneNeutral(rgb);
	return rgb.map((x) => {
		const v = clamp01(x);
		return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
	});
}

/** Khronos PBR Neutral, as /tonemap's toneNeutral. */
function toneNeutral(c: number[]): number[] {
	const start = 0.8 - 0.04;
	const desaturation = 0.15;
	const x = Math.min(c[0], c[1], c[2]);
	const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	let rgb = c.map((v) => v - offset);
	const peak = Math.max(rgb[0], rgb[1], rgb[2]);
	if (peak < start) return rgb;
	const d = 1 - start;
	const newPeak = 1 - (d * d) / (peak + d - start);
	rgb = rgb.map((v) => (v * newPeak) / peak);
	const g = 1 - 1 / (desaturation * (peak - newPeak) + 1);
	return rgb.map((v) => v + (newPeak - v) * g);
}

/** AgX's matrices, as /tonemap's toneAgx: GLSL's mat3 takes columns, so each row here is a column. */
const INSET = [
	[0.842479062253094, 0.0423282422610123, 0.0423756549057051],
	[0.0784335999999992, 0.878468636469772, 0.0784336],
	[0.0792237451477643, 0.0791661274605434, 0.879142973793104]
];
const OUTSET = [
	[1.19687900512017, -0.0528968517574562, -0.0529716355144438],
	[-0.0980208811401368, 1.15190312990417, -0.0980434501171241],
	[-0.0990297440797205, -0.0989611768448433, 1.15107367264116]
];
const MIN_EV = -12.47393;
const MAX_EV = 4.026069;

/** `m` (given as columns) times `v`. */
const apply = (m: number[][], v: number[]) => [0, 1, 2].map((i) => m[0][i] * v[0] + m[1][i] * v[1] + m[2][i] * v[2]);

/** AgX, as /tonemap's toneAgx: linear in, linear out. */
function toneAgx(c: number[]): number[] {
	const x = apply(INSET, c).map((v) => (Math.min(MAX_EV, Math.max(MIN_EV, Math.log2(Math.max(v, 1e-10)))) - MIN_EV) / (MAX_EV - MIN_EV));
	const curve = x.map((v) => {
		const v2 = v * v;
		const v4 = v2 * v2;
		return 15.5 * v4 * v2 - 40.14 * v4 * v + 31.96 * v4 - 6.868 * v2 * v + 0.4298 * v2 + 0.1191 * v - 0.00232;
	});
	return apply(OUTSET, curve).map((v) => Math.max(v, 0) ** 2.2);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
