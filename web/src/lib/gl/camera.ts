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

/** Read live (tuning.flight). */
export interface FlightSettings {
	/** How much a long flight backs off (zooms out) on the way: ρ of van Wijk & Nuij's path. */
	curvature: number;
	/** Seconds per unit of path length (about one view width travelled). */
	pace: number;
	minTime: number;
	maxTime: number;
	/** Ease-in-out power: 1 is constant speed, 3 cubic. The middle of a flight runs this many times the average speed. */
	ease: number;
}

/** A framed view (a POI): the ground point looked at (x, z; its height comes from the ground), distance, heading. */
export interface CameraPose {
	target: [number, number];
	distance: number;
	/** Compass heading in degrees: 0 looks north, 90 east. */
	heading: number;
}

const DEG = Math.PI / 180;
const UP: v3.Vec3 = [0, 1, 0];
/** Terrain samples along the target → eye line, to keep ridges from hiding what the camera looks at. */
const LINE_OF_SIGHT_SAMPLES = 10;
/** Points along a flight where the ground clearance is planned. */
const FLIGHT_SAMPLES = 48;

interface Flight {
	path: ZoomPath;
	/** Visible ground width per unit of distance: the path works in view widths. */
	widthPerDistance: number;
	yaw0: number;
	yawDelta: number;
	/** Planned target height at each sample, clear of the terrain (FLIGHT_SAMPLES + 1 values). */
	heights: Float32Array;
	end: CameraPose;
	time: number;
	duration: number;
	/** Read live (the panel edits it mid-flight). */
	settings: FlightSettings;
	onArrive?: () => void;
}

/**
 * The home page's survey camera: oblique, orbiting its target. Pitch is set by the zoom (tilts up toward
 * the horizon as it gets closer, looks down as it backs off); yaw (heading) is turned by the user and
 * eases back to north up on request. Panning never changes the view direction. Its target rides on the
 * ground and the eye never dips into the terrain.
 *
 * Input (controls.ts) either acts directly (drag, pinch, twist, rotate-drag) or sets goals that `update`
 * eases toward every frame (wheel zoom, inertia, keyboard, north reset). The matrices are shared by every
 * program that draws the scene (raymarch now; cords and particles later), so their depths agree.
 * `flyTo` / `jumpTo` move it between framed poses (the POIs); the free input is for authoring them (dev).
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
	/**
	 * Goes up only when the view actually changes (matrices differ), so passes can cache what they drew
	 * (the terrain re-marches only when this moves). Every easing snaps to its goal so a still camera is
	 * exactly still.
	 */
	revision = 0;
	private readonly world = m4.identity();
	private readonly lastViewProjection = new Float32Array(16);

	private panMin: [number, number] = [-Infinity, -Infinity];
	private panMax: [number, number] = [Infinity, Infinity];
	private velocity: [number, number] = [0, 0];
	private zoomAnchor: { ndc: [number, number]; point: Vec3 } | null = null;
	private goalYaw = 0;
	private yawVelocity = 0;
	private grounded = false;
	private flight: Flight | null = null;
	private readonly pathPoint: [number, number, number] = [0, 0, 0];

	constructor(
		private readonly settings: CameraSettings,
		private readonly motion: CameraMotionSettings
	) {
		this.distance = this.goalDistance = settings.maxDistance; // until the first jumpTo
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

	/** True while a `flyTo` is under way. */
	get flying(): boolean {
		return this.flight !== null;
	}

	/** The current view as a pose (dev: Copy pose). */
	pose(): CameraPose {
		const heading = (((-this.yaw / DEG) % 360) + 360) % 360;
		return { target: [this.target[0], this.target[2]], distance: this.distance, heading };
	}

	/** Go to a pose at once (first load, reduced motion). The height settles on the ground next update. */
	jumpTo(pose: CameraPose) {
		this.stop();
		this.flight = null;
		this.target[0] = pose.target[0];
		this.target[2] = pose.target[1];
		this.distance = this.goalDistance = pose.distance;
		this.yaw = this.goalYaw = -pose.heading * DEG;
		this.grounded = false;
		this.refresh();
	}

	/**
	 * Fly to a pose: van Wijk & Nuij's smooth pan-and-zoom path (it backs off in proportion to the distance
	 * travelled, and pitch follows the zoom, so the camera rises, glides and dives back in), heading turning
	 * the shortest way, eased in and out. The terrain doesn't move, so the clearance is planned once, here:
	 * the target height along the whole flight stays above what `follow()` would need at every point.
	 * Flying again mid-flight starts from where the camera is. Pan bounds don't apply.
	 */
	flyTo(pose: CameraPose, ground: GroundHeights, settings: FlightSettings, onArrive?: () => void) {
		this.stop();
		const widthPerDistance = 2 * Math.tan((this.settings.fov * DEG) / 2) * this.aspect;
		const path = zoomPath(
			this.target[0],
			this.target[2],
			this.distance * widthPerDistance,
			pose.target[0],
			pose.target[1],
			pose.distance * widthPerDistance,
			Math.max(0.1, settings.curvature)
		);
		const yaw0 = this.yaw;
		const yawDelta = wrapAngle(-pose.heading * DEG - yaw0);
		const turn = Math.abs(yawDelta) / Math.PI; // a half turn counts like one view width
		const duration = clamp(Math.max(path.length, turn) * settings.pace, settings.minTime, settings.maxTime);
		const heights = this.planHeights(ground, path, widthPerDistance, yaw0, yawDelta);
		this.flight = { path, widthPerDistance, yaw0, yawDelta, heights, end: pose, time: 0, duration, settings, onArrive };
	}

	/** Grabbing the ground stops every glide (pan and turn inertia, smooth zoom, heading ease, flight). */
	stop() {
		this.flight = null;
		this.velocity = [0, 0];
		this.yawVelocity = 0;
		this.zoomAnchor = null;
		this.goalDistance = this.distance;
		this.goalYaw = this.yaw;
	}

	/** Once per frame: a flight, or keyboard, inertia, smooth zoom, then ground following. */
	update(dt: number, ground: GroundHeights | null) {
		if (this.flight) {
			this.advanceFlight(this.flight, dt);
			return;
		}
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

		const vp = this.viewProjection;
		const last = this.lastViewProjection;
		for (let i = 0; i < 16; i++) {
			if (vp[i] !== last[i]) {
				last.set(vp);
				this.revision++;
				break;
			}
		}
	}

	/**
	 * The target's height eases toward the lowest height that keeps it on the ground and the whole line of
	 * sight to the eye (eye included, with some clearance) above the terrain: a ridge in between lifts the
	 * camera instead of hiding what it looks at. Rises faster than it sinks.
	 */
	private follow(ground: GroundHeights, dt: number) {
		const desired = this.restHeight(ground, this.target[0], this.target[2], this.distance, this.yaw);
		if (!this.grounded) {
			this.target[1] = desired;
			this.grounded = true;
		} else {
			const rate = desired > this.target[1] ? 10 : 3;
			this.target[1] += (desired - this.target[1]) * (1 - Math.exp(-dt * rate));
			if (Math.abs(desired - this.target[1]) < 1e-3) this.target[1] = desired; // settle exactly
		}
		this.refresh();
	}

	/** The target height `follow()` settles on at (x, z) for a distance and heading: on the ground, line of sight clear. */
	private restHeight(ground: GroundHeights, x: number, z: number, distance: number, yaw: number): number {
		const pitch = this.pitchFor(distance);
		const horizontal = distance * Math.cos(pitch);
		const rise = distance * Math.sin(pitch); // eye height above the target
		const dx = Math.sin(yaw) * horizontal;
		const dz = Math.cos(yaw) * horizontal;
		const clearance = 2 + distance * 0.05;
		let desired = ground.heightAt(x, z);
		for (let i = 1; i <= LINE_OF_SIGHT_SAMPLES; i++) {
			const f = i / LINE_OF_SIGHT_SAMPLES; // 1 = the eye
			const h = ground.heightAt(x + dx * f, z + dz * f);
			desired = Math.max(desired, h + (clearance - rise) * f);
		}
		return desired;
	}

	/**
	 * Target heights along a flight: the rest height at each sample, capped by smooth parabolas over every
	 * obstacle (wider when the camera is farther), so the camera starts rising before a ridge instead of
	 * reacting to it. The ends blend back to the exact start height and the destination's rest height, so
	 * the flight leaves from the current view and lands on the framed one.
	 */
	private planHeights(ground: GroundHeights, path: ZoomPath, widthPerDistance: number, yaw0: number, yawDelta: number) {
		const n = FLIGHT_SAMPLES;
		const rest = new Float32Array(n + 1);
		const along = new Float32Array(n + 1); // ground distance travelled by the target
		const reach = new Float32Array(n + 1); // half-width of the cap over each sample
		const p = this.pathPoint;
		let px = 0;
		let pz = 0;
		for (let i = 0; i <= n; i++) {
			const t = i / n;
			path.at(t, p);
			const distance = p[2] / widthPerDistance;
			rest[i] = this.restHeight(ground, p[0], p[1], distance, yaw0 + yawDelta * t);
			along[i] = i === 0 ? 0 : along[i - 1] + Math.hypot(p[0] - px, p[1] - pz);
			reach[i] = Math.max(10, distance * 0.3);
			px = p[0];
			pz = p[1];
		}
		const heights = new Float32Array(n + 1);
		for (let i = 0; i <= n; i++) {
			let h = -Infinity;
			for (let j = 0; j <= n; j++) {
				const ds = along[i] - along[j];
				h = Math.max(h, rest[j] - (ds * ds) / (2 * reach[j]));
			}
			heights[i] = h;
		}
		const fromStart = this.target[1] - heights[0];
		const toEnd = rest[n] - heights[n];
		for (let i = 0; i <= n; i++) {
			const t = i / n;
			heights[i] += fromStart * (1 - smoothstep(0, 0.25, t)) + toEnd * smoothstep(0.75, 1, t);
		}
		return heights;
	}

	private advanceFlight(flight: Flight, dt: number) {
		flight.time = Math.min(flight.duration, flight.time + dt);
		const t = easeInOut(flight.duration > 0 ? flight.time / flight.duration : 1, flight.settings.ease);
		const p = this.pathPoint;
		flight.path.at(t, p);
		this.target[0] = p[0];
		this.target[2] = p[1];
		this.distance = this.goalDistance = p[2] / flight.widthPerDistance;
		this.yaw = this.goalYaw = flight.yaw0 + flight.yawDelta * t;
		const x = t * FLIGHT_SAMPLES;
		const i = Math.min(FLIGHT_SAMPLES - 1, Math.floor(x));
		this.target[1] = flight.heights[i] + (flight.heights[i + 1] - flight.heights[i]) * (x - i);

		if (flight.time >= flight.duration) {
			// Land exactly on the pose; follow() takes over from the same height
			const { end } = flight;
			this.target[0] = end.target[0];
			this.target[2] = end.target[1];
			this.distance = this.goalDistance = end.distance;
			this.yaw = this.goalYaw = flight.yaw0 + flight.yawDelta;
			this.target[1] = flight.heights[FLIGHT_SAMPLES];
			this.flight = null;
			this.refresh();
			flight.onArrive?.();
			return;
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

function smoothstep(edge0: number, edge1: number, x: number) {
	const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
	return t * t * (3 - 2 * t);
}

/** Symmetric ease in and out: speed peaks at `power` times the average, mid-way (3: cubic). */
function easeInOut(t: number, power: number) {
	return t < 0.5 ? (2 * t) ** power / 2 : 1 - (2 - 2 * t) ** power / 2;
}

interface ZoomPath {
	/** Path length, in view widths (the flight's duration scales with it). */
	length: number;
	/** Point at t ∈ [0, 1]: out = [x, z, view width]. */
	at(t: number, out: [number, number, number]): void;
}

/**
 * Smooth and efficient zooming and panning (van Wijk & Nuij, 2003; the same path as d3.interpolateZoom):
 * from centre (x0, z0) seeing a width w0, to (x1, z1) seeing w1. It zooms out in proportion to the distance
 * travelled, so the motion feels the same speed everywhere; `rho` sets how much (√2 is the classic value).
 */
function zoomPath(x0: number, z0: number, w0: number, x1: number, z1: number, w1: number, rho: number): ZoomPath {
	const dx = x1 - x0;
	const dz = z1 - z0;
	const d2 = dx * dx + dz * dz;
	if (d2 < 1e-6) {
		// Zoom only
		const s = Math.log(w1 / w0) / rho;
		return {
			length: Math.abs(s),
			at(t, out) {
				out[0] = x0 + t * dx;
				out[1] = z0 + t * dz;
				out[2] = w0 * Math.exp(rho * t * s);
			}
		};
	}
	const rho2 = rho * rho;
	const d1 = Math.sqrt(d2);
	const b0 = (w1 * w1 - w0 * w0 + rho2 * rho2 * d2) / (2 * w0 * rho2 * d1);
	const b1 = (w1 * w1 - w0 * w0 - rho2 * rho2 * d2) / (2 * w1 * rho2 * d1);
	const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
	const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
	const length = (r1 - r0) / rho;
	const coshR0 = Math.cosh(r0);
	const sinhR0 = Math.sinh(r0);
	return {
		length,
		at(t, out) {
			const s = t * length;
			const u = (w0 / (rho2 * d1)) * (coshR0 * Math.tanh(rho * s + r0) - sinhR0);
			out[0] = x0 + u * dx;
			out[1] = z0 + u * dz;
			out[2] = (w0 * coshR0) / Math.cosh(rho * s + r0);
		}
	};
}

/** Angle in (−π, π]. */
export function wrapAngle(a: number) {
	return a - 2 * Math.PI * Math.ceil((a - Math.PI) / (2 * Math.PI));
}
