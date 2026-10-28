import { m4, type v3 } from 'twgl.js';
import type { Vec3 } from '$lib/terrain/heightfield';

/** What the camera needs from the ground (terrain/ground.ts): heights, past the heightmap edges too. */
export interface GroundHeights {
	heightAt(x: number, z: number): number;
}

/** Read live (the dev panel edits them). Angles in degrees, distances in world units. */
export interface CameraSettings {
	/** Pitch (down from the horizontal) at the closest zoom: the camera tilts up as it dives in. */
	pitchNear: number;
	/** Pitch at the farthest zoom. */
	pitchFar: number;
	/** Shapes where the tilt happens along the zoom range: above 1 it tilts up earlier while zooming in. */
	tiltCurve: number;
	/** Vertical field of view. */
	fov: number;
	/** Start distance (only read at construction). */
	distance: number;
	minDistance: number;
	maxDistance: number;
}

/** Read live. Rates are per second. */
export interface CameraMotionSettings {
	zoomSmoothing: number;
	inertiaDecay: number;
	/** Keyboard pan speed, in distances per second. */
	keyboardSpeed: number;
	/** Keyboard rotation speed, degrees per second. */
	keyboardRotateSpeed: number;
}

const DEG = Math.PI / 180;
const UP: v3.Vec3 = [0, 1, 0];
/** Terrain samples along the target → eye line, to keep ridges from hiding what the camera looks at. */
const LINE_OF_SIGHT_SAMPLES = 10;

/**
 * The home page's survey camera: oblique, orbiting its target. Pitch is set by the zoom (tilts up toward
 * the horizon as it gets closer, looks down as it backs off); yaw (heading) is turned by the user and
 * eases back to north up on request. Panning never changes the view direction. Its target rides on the
 * ground and the eye never dips into the terrain.
 *
 * Input (controls.ts) either acts directly (drag, pinch, twist, rotate-drag) or sets goals that `update`
 * eases toward every frame (wheel zoom, inertia, keyboard, north reset). The matrices are shared by every
 * program that draws the scene (raymarch now; cords, particles and splats later), so their depths agree.
 */
export class SurveyCamera {
	readonly target: Vec3 = [0, 0, 0];
	readonly eye: Vec3 = [0, 0, 0];
	/** Current pitch in radians, derived from the distance. */
	pitch = 0;
	/** Radians; 0 looks north (−Z), positive turns the heading toward the west. */
	yaw = 0;
	distance: number;
	/** Where the smooth zoom is heading. */
	goalDistance: number;
	aspect = 1;
	near = 1;
	far = 2000;
	/**
	 * Keyboard input, set by the controls: pan in screen terms (x right, y up), zoom (−1 in, +1 out),
	 * rotate (+1 turns the heading left).
	 */
	readonly keys = { x: 0, y: 0, zoom: 0, rotate: 0 };

	readonly view = m4.identity();
	readonly projection = m4.identity();
	readonly viewProjection = m4.identity();
	readonly inverseViewProjection = m4.identity();
	private readonly world = m4.identity();

	private panMin: [number, number] = [-Infinity, -Infinity];
	private panMax: [number, number] = [Infinity, Infinity];
	private velocity: [number, number] = [0, 0];
	private zoomAnchor: { ndc: [number, number]; point: Vec3 } | null = null;
	private goalYaw = 0;
	private yawVelocity = 0;
	private grounded = false;

	constructor(
		private readonly settings: CameraSettings,
		private readonly motion: CameraMotionSettings
	) {
		this.distance = this.goalDistance = this.clampDistance(settings.distance);
		this.refresh();
	}

	/** Keep the target inside a world rectangle (x/z), e.g. the terrain bounds minus a margin. */
	setPanBounds(minX: number, minZ: number, maxX: number, maxZ: number) {
		this.panMin = [minX, minZ];
		this.panMax = [maxX, maxZ];
		this.pan(0, 0);
	}

	/** Move the target along the ground, clamped to the pan bounds (inertia stops at a bound). */
	pan(dx: number, dz: number) {
		const x = this.target[0] + dx;
		const z = this.target[2] + dz;
		this.target[0] = clamp(x, this.panMin[0], this.panMax[0]);
		this.target[2] = clamp(z, this.panMin[1], this.panMax[1]);
		if (this.target[0] !== x) this.velocity[0] = 0;
		if (this.target[2] !== z) this.velocity[1] = 0;
		this.refresh();
	}

	/** Immediate zoom (pinch). Cancels any smooth zoom in progress. */
	setDistance(distance: number) {
		this.distance = this.goalDistance = this.clampDistance(distance);
		this.zoomAnchor = null;
		this.refresh();
	}

	/** Smooth zoom toward `goal`, keeping `anchor.point` under the same spot of the view (NDC) if given. */
	zoomTo(goal: number, anchor: { ndc: [number, number]; point: Vec3 } | null = null) {
		this.goalDistance = this.clampDistance(goal);
		this.zoomAnchor = anchor;
	}

	/** Turn the heading around the target, immediately (rotate-drag, twist). Radians. */
	rotate(delta: number) {
		this.yaw += delta;
		this.goalYaw = this.yaw;
		this.refresh();
	}

	/** Ease back to north up, the shortest way round. */
	resetNorth() {
		this.yawVelocity = 0;
		this.goalYaw = this.yaw - wrapAngle(this.yaw);
	}

	/** Start gliding after a drag, in world units per second. */
	fling(vx: number, vz: number) {
		this.velocity = [vx, vz];
	}

	/** Keep turning after a rotate-drag or twist, in radians per second. */
	flingYaw(radiansPerSecond: number) {
		this.yawVelocity = radiansPerSecond;
	}

	/** Grabbing the ground stops every glide (pan and turn inertia, smooth zoom, heading ease). */
	stop() {
		this.velocity = [0, 0];
		this.yawVelocity = 0;
		this.zoomAnchor = null;
		this.goalDistance = this.distance;
		this.goalYaw = this.yaw;
	}

	/** Once per frame: keyboard, inertia, smooth zoom, then ground following. */
	update(dt: number, ground: GroundHeights | null) {
		const motion = this.motion;
		// Zoom limits may have been edited
		this.goalDistance = this.clampDistance(this.goalDistance);

		const { x, y, zoom } = this.keys;
		if (x || y) {
			const step = this.distance * motion.keyboardSpeed * dt;
			const s = Math.sin(this.yaw);
			const c = Math.cos(this.yaw);
			this.pan((x * c - y * s) * step, (-x * s - y * c) * step); // screen right / screen up on the ground
		}
		if (zoom) {
			this.goalDistance = this.clampDistance(this.goalDistance * Math.exp(zoom * dt * 1.6));
			this.zoomAnchor = null;
		}
		if (this.yawVelocity) {
			this.rotate(this.yawVelocity * dt);
			this.yawVelocity *= Math.exp(-dt * motion.inertiaDecay);
			if (Math.abs(this.yawVelocity) < 0.02) this.yawVelocity = 0;
		}
		if (this.keys.rotate) this.goalYaw += this.keys.rotate * motion.keyboardRotateSpeed * DEG * dt;
		if (this.yaw !== this.goalYaw) {
			let yaw = this.yaw + (this.goalYaw - this.yaw) * (1 - Math.exp(-dt * motion.zoomSmoothing));
			if (Math.abs(this.goalYaw - yaw) < 1e-4) yaw = this.goalYaw;
			this.yaw = yaw;
			this.refresh();
		}

		if (this.velocity[0] || this.velocity[1]) {
			this.pan(this.velocity[0] * dt, this.velocity[1] * dt);
			const decay = Math.exp(-dt * motion.inertiaDecay);
			this.velocity[0] *= decay;
			this.velocity[1] *= decay;
			if (Math.hypot(this.velocity[0], this.velocity[1]) < this.distance * 0.01) this.velocity = [0, 0];
		}

		if (this.distance !== this.goalDistance) {
			// Ease in log space, so zooming in and out feel the same
			const k = 1 - Math.exp(-dt * motion.zoomSmoothing);
			let d = Math.exp(Math.log(this.distance) + Math.log(this.goalDistance / this.distance) * k);
			if (Math.abs(d - this.goalDistance) < this.goalDistance * 1e-3) d = this.goalDistance;
			this.distance = d;
			this.refresh();
			const anchor = this.zoomAnchor;
			if (anchor) {
				const p = this.groundPoint(anchor.ndc[0], anchor.ndc[1], anchor.point[1]);
				if (p) this.pan(anchor.point[0] - p[0], anchor.point[2] - p[2]);
			}
			if (d === this.goalDistance) this.zoomAnchor = null;
		}

		if (ground) this.follow(ground, dt);
		else this.refresh();
	}

	setAspect(aspect: number) {
		if (aspect === this.aspect) return;
		this.aspect = aspect;
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

	/** Recompute pitch, eye and matrices from target, distance, yaw, settings and aspect. */
	refresh() {
		this.pitch = this.pitchFor(this.distance);
		const horizontal = this.distance * Math.cos(this.pitch);
		this.eye[0] = this.target[0] + Math.sin(this.yaw) * horizontal;
		this.eye[1] = this.target[1] + this.distance * Math.sin(this.pitch);
		this.eye[2] = this.target[2] + Math.cos(this.yaw) * horizontal;
		// Near as far out as the zoom allows, for depth precision (cords will sit just above the ground)
		this.near = Math.max(0.5, this.distance * 0.02);
		this.far = Math.max(2000, this.distance * 8);
		m4.lookAt(this.eye, this.target, UP, this.world);
		m4.inverse(this.world, this.view);
		m4.perspective(this.settings.fov * DEG, this.aspect, this.near, this.far, this.projection);
		m4.multiply(this.projection, this.view, this.viewProjection);
		m4.inverse(this.viewProjection, this.inverseViewProjection);
	}

	/**
	 * The target's height eases toward the lowest height that keeps it on the ground and the whole line of
	 * sight to the eye (eye included, with some clearance) above the terrain: a ridge in between lifts the
	 * camera instead of hiding what it looks at. Rises faster than it sinks.
	 */
	private follow(ground: GroundHeights, dt: number) {
		const horizontal = this.distance * Math.cos(this.pitch);
		const rise = this.distance * Math.sin(this.pitch); // eye height above the target
		const dx = Math.sin(this.yaw) * horizontal;
		const dz = Math.cos(this.yaw) * horizontal;
		const clearance = 2 + this.distance * 0.05;
		let desired = ground.heightAt(this.target[0], this.target[2]);
		for (let i = 1; i <= LINE_OF_SIGHT_SAMPLES; i++) {
			const f = i / LINE_OF_SIGHT_SAMPLES; // 1 = the eye
			const h = ground.heightAt(this.target[0] + dx * f, this.target[2] + dz * f);
			desired = Math.max(desired, h + (clearance - rise) * f);
		}
		if (!this.grounded) {
			this.target[1] = desired;
			this.grounded = true;
		} else {
			const rate = desired > this.target[1] ? 10 : 3;
			this.target[1] += (desired - this.target[1]) * (1 - Math.exp(-dt * rate));
		}
		this.refresh();
	}

	/** Pitch from distance: position on a log scale between the zoom limits, shaped by tiltCurve, smoothstep. */
	private pitchFor(distance: number) {
		const s = this.settings;
		const range = Math.log(s.maxDistance / s.minDistance);
		const linear = range > 0 ? clamp(Math.log(distance / s.minDistance) / range, 0, 1) : 0;
		const t = Math.pow(linear, s.tiltCurve);
		return (s.pitchNear + (s.pitchFar - s.pitchNear) * t * t * (3 - 2 * t)) * DEG;
	}

	private clampDistance(distance: number) {
		return clamp(distance, this.settings.minDistance, this.settings.maxDistance);
	}
}

function clamp(v: number, lo: number, hi: number) {
	return v < lo ? lo : v > hi ? hi : v;
}

/** Angle in (−π, π]. */
export function wrapAngle(a: number) {
	return a - 2 * Math.PI * Math.ceil((a - Math.PI) / (2 * Math.PI));
}
