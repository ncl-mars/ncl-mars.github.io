import type { Vec3 } from './heightfield';

/** What the CPU needs from tuning.fog and tuning.mist (read live). */
export interface FogSettings {
	density: number;
	end: number;
}

export interface MistSettings {
	density: number;
	falloff: number;
}

/**
 * How much of a point the atmosphere hides, seen from `eye`: 0 clear … 1 fully fogged. The distance fog and
 * height mist of `atmosphere()` in gl/chunks/fog.glsl, without the drifting banks (their mean), so DOM
 * overlays (labels) fade with the scene. Keep in step with fog.glsl. `mistBase` is the mist's base height in
 * world units (the lowest ground + mist.height, as the terrain composite sets it).
 */
export function fogAmount(eye: Vec3, point: Vec3, fog: FogSettings, mist: MistSettings, mistBase: number): number {
	const dx = point[0] - eye[0];
	const dy = point[1] - eye[1];
	const dz = point[2] - eye[2];
	const t = Math.hypot(dx, dy, dz);
	if (t === 0) return 0;

	// Optical depth of the height mist along the ray, closed form (mistDepth in fog.glsl)
	const rdY = dy / t;
	const falloff = Math.max(0.1, mist.falloff);
	const h0 = clamp((eye[1] - mistBase) / falloff, -30, 80);
	let mistDepth: number;
	if (Math.abs(rdY) < 1e-4) {
		mistDepth = mist.density * Math.exp(-h0) * t;
	} else {
		const h1 = clamp((eye[1] + rdY * t - mistBase) / falloff, -30, 80);
		mistDepth = (mist.density * falloff * (Math.exp(-h0) - Math.exp(-h1))) / rdY;
	}

	const distanceFog = Math.max(1 - Math.exp(-t * fog.density), smoothstep(fog.end * 0.55, fog.end, t));
	return 1 - (1 - distanceFog) * Math.exp(-mistDepth);
}

function clamp(v: number, lo: number, hi: number) {
	return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0: number, edge1: number, x: number) {
	const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
	return t * t * (3 - 2 * t);
}
