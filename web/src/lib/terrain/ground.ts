import { coreMask, farFbm, type FarFieldSettings } from './farfield';
import type { Heightfield, Vec3 } from './heightfield';

/**
 * The whole ground as the CPU sees it: the heightmap blended into the endless far field, exactly like
 * terrain.glsl. Camera following, line of sight and picking go through this, never through the raw
 * heightmap, so they work past its edges too. Settings are read live (dev panel).
 */
export class Ground {
	constructor(
		readonly field: Heightfield,
		private readonly far: FarFieldSettings,
		private readonly fog: { end: number }
	) {}

	/** Far-field base level: the mean height of the heightmap's edges, plus the tuned offset. */
	get farBase(): number {
		return this.field.edgeMean + this.far.offset;
	}

	/** Blend band width in world units. */
	get band(): number {
		const { min, max } = this.field.meta.bounds;
		return Math.max(1e-3, this.far.blend * Math.min(max[0] - min[0], max[2] - min[2]));
	}

	/** Height range of the whole ground (heightmap and far field): the slab the raymarch searches. */
	get slab(): [number, number] {
		const { min, max } = this.field.meta.bounds;
		return [Math.min(min[1], this.farBase - this.far.amplitude), Math.max(max[1], this.farBase + this.far.amplitude)];
	}

	heightAt(x: number, z: number): number {
		const { min, max } = this.field.meta.bounds;
		const mask = coreMask(x, z, min, max, this.band);
		if (mask >= 1) return this.field.heightAt(x, z);
		const far = this.farBase + this.far.amplitude * (farFbm(x / this.far.scale, z / this.far.scale) * 2 - 1);
		return mask <= 0 ? far : far + (this.field.heightAt(x, z) - far) * mask;
	}

	/**
	 * First point where a ray meets the ground, within the fog end distance, or null (picking, grab-to-pan).
	 * Fixed steps across the ground's height slab, then bisection.
	 */
	raycast(origin: Vec3, direction: Vec3, steps = 256): Vec3 | null {
		const [bottom, top] = this.slab;
		let enter = 0;
		let exit = this.fog.end;
		if (direction[1] === 0) {
			if (origin[1] < bottom || origin[1] > top) return null;
		} else {
			const t0 = (top - origin[1]) / direction[1];
			const t1 = (bottom - origin[1]) / direction[1];
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
