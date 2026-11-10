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
	else if (curve > 0.5) rgb = toneNeutral(rgb);
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

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
