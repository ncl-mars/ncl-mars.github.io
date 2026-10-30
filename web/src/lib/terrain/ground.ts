import { coreMask, farFbm, type FarFieldSettings } from './farfield';
import type { Heightfield, Vec3 } from './heightfield';

/** The sea: the ground never goes below it (the seabed under it gives the water its depth). Mirror of terrain.glsl. */
export const SEA_LEVEL = 0;

/**
 * The whole ground as the CPU sees it, exactly like terrain.glsl: the heightmap, blended into the far map
 * around it if there is one (a low-resolution export of the surroundings), blended into the endless noise
 * beyond; never below the sea. Camera following, line of sight and picking go through this, never through
 * the raw heightmaps, so they work past their edges too. Settings are read live (dev panel).
 */
export class Ground {
	constructor(
		readonly field: Heightfield,
		/** The surroundings, low resolution, or null: the noise starts at the heightmap's edges. */
		readonly farMap: Heightfield | null,
		private readonly far: FarFieldSettings,
		private readonly fog: { end: number }
	) {}

	/** Base level of the endless noise: the mean height of the outermost map's edges, plus the tuned offset. */
	get farBase(): number {
		return (this.farMap ?? this.field).edgeMean + this.far.offset;
	}

	/** Blend band of the heightmap into what surrounds it, world units. */
	get band(): number {
		return blendBand(this.field, this.far.blend);
	}

	/** Blend band of the far map into the noise, world units (0 without a far map). */
	get farBand(): number {
		return this.farMap ? blendBand(this.farMap, this.far.blend) : 0;
	}

	/** Height range of the whole ground (heightmaps, noise, the sea): the slab the raymarch searches. */
	get slab(): [number, number] {
		let lo = Math.min(this.field.meta.bounds.min[1], this.farBase - this.far.amplitude);
		let hi = Math.max(this.field.meta.bounds.max[1], this.farBase + this.far.amplitude);
		if (this.farMap) {
			lo = Math.min(lo, this.farMap.meta.bounds.min[1]);
			hi = Math.max(hi, this.farMap.meta.bounds.max[1]);
		}
		return [Math.max(lo, SEA_LEVEL), Math.max(hi, SEA_LEVEL)];
	}

	/** The ground's surface: the terrain, or the sea over it. */
	heightAt(x: number, z: number): number {
		return Math.max(this.terrainAt(x, z), SEA_LEVEL);
	}

	/** The terrain itself, the seabed included. */
	terrainAt(x: number, z: number): number {
		const { min, max } = this.field.meta.bounds;
		const mask = coreMask(x, z, min, max, this.band);
		if (mask >= 1) return this.field.heightAt(x, z);
		const outer = this.surroundingsAt(x, z);
		return mask <= 0 ? outer : outer + (this.field.heightAt(x, z) - outer) * mask;
	}

	/** Around the heightmap: the far map where there is one, fading into the noise at its edges. */
	private surroundingsAt(x: number, z: number): number {
		const farMap = this.farMap;
		if (farMap) {
			const { min, max } = farMap.meta.bounds;
			const m = coreMask(x, z, min, max, this.farBand);
			if (m >= 1) return farMap.heightAt(x, z);
			if (m > 0) return this.noiseAt(x, z) + (farMap.heightAt(x, z) - this.noiseAt(x, z)) * m;
		}
		return this.noiseAt(x, z);
	}

	private noiseAt(x: number, z: number): number {
		return this.farBase + this.far.amplitude * (farFbm(x / this.far.scale, z / this.far.scale) * 2 - 1);
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

/** `fraction` of a map's smaller side, world units. */
function blendBand(map: Heightfield, fraction: number): number {
	const { min, max } = map.meta.bounds;
	return Math.max(1e-3, fraction * Math.min(max[0] - min[0], max[2] - min[2]));
}
