import { m4, type v3 } from 'twgl.js';
import type { Heightfield, Vec3 } from '$lib/terrain/heightfield';

export interface SurveyCameraOptions {
	/** Degrees down from the horizontal. */
	pitch?: number;
	/** Degrees; 0 looks north (−Z). */
	yaw?: number;
	/** Vertical field of view, degrees. */
	fov?: number;
	distance?: number;
	minDistance?: number;
	maxDistance?: number;
}

const DEG = Math.PI / 180;
const UP: v3.Vec3 = [0, 1, 0];

/**
 * The home page's survey camera: oblique, with a fixed orientation (pitch and yaw never change outside the
 * dive, so splat depth order doesn't either), moved only by pan and zoom. Its target rides on the ground and
 * the eye never dips into the terrain. The matrices are shared by every program that draws the scene
 * (raymarch now; cords, particles and splats later), so their depths agree.
 */
export class SurveyCamera {
	readonly target: Vec3 = [0, 0, 0];
	readonly eye: Vec3 = [0, 0, 0];
	pitch: number;
	yaw: number;
	fov: number;
	distance: number;
	minDistance: number;
	maxDistance: number;
	aspect = 1;
	near = 1;
	far = 2000;

	readonly view = m4.identity();
	readonly projection = m4.identity();
	readonly viewProjection = m4.identity();
	readonly inverseViewProjection = m4.identity();
	private readonly world = m4.identity();

	private panMin: [number, number] = [-Infinity, -Infinity];
	private panMax: [number, number] = [Infinity, Infinity];
	private grounded = false;

	constructor(options: SurveyCameraOptions = {}) {
		this.pitch = (options.pitch ?? 45) * DEG;
		this.yaw = (options.yaw ?? 0) * DEG;
		this.fov = (options.fov ?? 35) * DEG;
		this.minDistance = options.minDistance ?? 60;
		this.maxDistance = options.maxDistance ?? 700;
		this.distance = clamp(options.distance ?? 350, this.minDistance, this.maxDistance);
		this.refresh();
	}

	/** Keep the target inside a world rectangle (x/z), e.g. the terrain bounds minus a margin. */
	setPanBounds(minX: number, minZ: number, maxX: number, maxZ: number) {
		this.panMin = [minX, minZ];
		this.panMax = [maxX, maxZ];
		this.pan(0, 0);
	}

	/** Move the target along the ground, clamped to the pan bounds. */
	pan(dx: number, dz: number) {
		this.target[0] = clamp(this.target[0] + dx, this.panMin[0], this.panMax[0]);
		this.target[2] = clamp(this.target[2] + dz, this.panMin[1], this.panMax[1]);
		this.refresh();
	}

	setDistance(distance: number) {
		this.distance = clamp(distance, this.minDistance, this.maxDistance);
		this.refresh();
	}

	setAspect(aspect: number) {
		if (aspect === this.aspect) return;
		this.aspect = aspect;
		this.refresh();
	}

	/**
	 * Once per frame: the target's height eases toward the ground under it, raised when needed so the eye
	 * stays above the ground under the eye. Rises faster than it sinks.
	 */
	follow(field: Heightfield, dt: number) {
		const horizontal = this.distance * Math.cos(this.pitch);
		const eyeX = this.target[0] + Math.sin(this.yaw) * horizontal;
		const eyeZ = this.target[2] + Math.cos(this.yaw) * horizontal;
		const clearance = 2 + this.distance * 0.05;
		const desired = Math.max(
			field.heightAt(this.target[0], this.target[2]),
			field.heightAt(eyeX, eyeZ) + clearance - this.distance * Math.sin(this.pitch)
		);
		if (!this.grounded) {
			this.target[1] = desired;
			this.grounded = true;
		} else {
			const rate = desired > this.target[1] ? 10 : 3;
			this.target[1] += (desired - this.target[1]) * (1 - Math.exp(-dt * rate));
		}
		this.refresh();
	}

	/** World-space ray through a point of the view, given in NDC (−1..1, y up). */
	ray(ndcX: number, ndcY: number): { origin: Vec3; direction: Vec3 } {
		const far = m4.transformPoint(this.inverseViewProjection, [ndcX, ndcY, 1]);
		const d: Vec3 = [far[0] - this.eye[0], far[1] - this.eye[1], far[2] - this.eye[2]];
		const length = Math.hypot(d[0], d[1], d[2]);
		return { origin: [...this.eye], direction: [d[0] / length, d[1] / length, d[2] / length] };
	}

	/** Where the ray through an NDC point crosses the plane y = planeY, or null if it never does. */
	groundPoint(ndcX: number, ndcY: number, planeY: number): Vec3 | null {
		const { origin, direction } = this.ray(ndcX, ndcY);
		if (direction[1] > -1e-4) return null;
		const t = (planeY - origin[1]) / direction[1];
		if (t <= 0) return null;
		return [origin[0] + direction[0] * t, planeY, origin[2] + direction[2] * t];
	}

	/** Recompute eye and matrices from target, distance, pitch, yaw and aspect. */
	refresh() {
		const horizontal = this.distance * Math.cos(this.pitch);
		this.eye[0] = this.target[0] + Math.sin(this.yaw) * horizontal;
		this.eye[1] = this.target[1] + this.distance * Math.sin(this.pitch);
		this.eye[2] = this.target[2] + Math.cos(this.yaw) * horizontal;
		// Near as far out as the zoom allows, for depth precision (cords will sit just above the ground)
		this.near = Math.max(0.5, this.distance * 0.02);
		this.far = Math.max(2000, this.distance * 8);
		m4.lookAt(this.eye, this.target, UP, this.world);
		m4.inverse(this.world, this.view);
		m4.perspective(this.fov, this.aspect, this.near, this.far, this.projection);
		m4.multiply(this.projection, this.view, this.viewProjection);
		m4.inverse(this.viewProjection, this.inverseViewProjection);
	}
}

function clamp(v: number, lo: number, hi: number) {
	return v < lo ? lo : v > hi ? hi : v;
}
