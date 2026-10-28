import type { Attachment } from 'svelte/attachments';
import { wrapAngle, type SurveyCamera } from './camera';
import type { Vec3 } from '$lib/terrain/heightfield';

export interface SurveyControlsOptions {
	/** The CPU ground once loaded (terrain/ground.ts): grabs and zooms anchor on the real ground. */
	ground?: () => { raycast(origin: Vec3, direction: Vec3): Vec3 | null } | null;
	/** Read live (the dev panel edits them). */
	settings?: { wheelSpeed: number; rotateSpeed: number };
}

type Binding = ['x' | 'y' | 'zoom' | 'rotate', number] | 'north';

/**
 * Movement keys by physical position (event.code), so WASD is ZQSD on AZERTY and Q/E (A/E on AZERTY)
 * sit next to them on every layout.
 */
const KEY_CODES: Record<string, Binding> = {
	ArrowUp: ['y', 1],
	KeyW: ['y', 1],
	ArrowDown: ['y', -1],
	KeyS: ['y', -1],
	ArrowLeft: ['x', -1],
	KeyA: ['x', -1],
	ArrowRight: ['x', 1],
	KeyD: ['x', 1],
	KeyQ: ['rotate', 1],
	KeyE: ['rotate', -1],
	KeyN: 'north',
	PageUp: ['zoom', -1],
	PageDown: ['zoom', 1],
	NumpadAdd: ['zoom', -1],
	NumpadSubtract: ['zoom', 1]
};

/** Zoom keys by character: '-' is on the 6 key on AZERTY, '+' needs Shift on most layouts. */
const KEY_CHARS: Record<string, Binding> = {
	'+': ['zoom', -1],
	'=': ['zoom', -1],
	'-': ['zoom', 1],
	_: ['zoom', 1]
};

const DEG = Math.PI / 180;

/**
 * Input for the survey camera, attached to the view element (the canvas ignores pointers):
 * `<div tabindex="0" {@attach surveyControls(camera, { ground, settings })}>`. Native Pointer Events.
 * - Drag (mouse, one finger) grabs the ground: the point under the pointer stays under it. Releasing
 *   while moving leaves some inertia.
 * - Right-drag or Alt+drag rotates the heading around the view centre.
 * - Wheel and trackpad pinch: smooth zoom toward the pointer. Two fingers: pinch zooms, twist rotates,
 *   both around the point between the fingers, which also pans.
 * - Double-click / double-tap: zoom in toward that point.
 * - Keyboard (when the element has focus): WASD / ZQSD / arrows pan, Q / E (A / E on AZERTY) rotate,
 *   N back to north up, + / − zoom.
 * Layout is read here, in input events, never in the frame loop. The element needs `touch-action: none`.
 */
export function surveyControls(camera: SurveyCamera, options: SurveyControlsOptions = {}): Attachment<HTMLElement> {
	return (el) => {
		const pointers = new Map<number, { x: number; y: number }>();
		let grab: { planeY: number; point: Vec3 } | null = null;
		let pinchDistance = 0;
		let rotating: { id: number; x: number } | null = null;
		// Recent target positions / headings while dragging or turning, to compute the release velocity
		let samples: { time: number; x: number; z: number }[] = [];
		let yawSamples: { time: number; yaw: number }[] = [];
		let downAt = { x: 0, y: 0, time: 0 };
		let lastTap = { x: 0, y: 0, time: -Infinity };
		const pressed = new Map<string, Binding>(); // by event.code, so keyup releases what keydown pressed

		const toNdc = (x: number, y: number): [number, number] => {
			const r = el.getBoundingClientRect();
			return [((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2];
		};

		/** The ground under (x, y): a CPU raycast once the ground is loaded, else the target's plane. */
		const pick = (x: number, y: number): Vec3 | null => {
			const ndc = toNdc(x, y);
			const ground = options.ground?.();
			if (ground) {
				const { origin, direction } = camera.ray(...ndc);
				const hit = ground.raycast(origin, direction);
				if (hit) return hit;
			}
			return camera.groundPoint(...ndc, camera.target[1]);
		};

		const startGrab = (x: number, y: number) => {
			const point = pick(x, y);
			grab = point ? { planeY: point[1], point } : null;
		};

		/** Pan so the grabbed point ends up under (x, y). */
		const dragTo = (x: number, y: number) => {
			if (!grab) return;
			const p = camera.groundPoint(...toNdc(x, y), grab.planeY);
			if (p) camera.pan(grab.point[0] - p[0], grab.point[2] - p[2]);
		};

		/** Immediate zoom by `factor`, keeping the ground under (x, y) in place (pinch). */
		const zoomAt = (x: number, y: number, factor: number) => {
			const ndc = toNdc(x, y);
			const before = pick(x, y);
			camera.setDistance(camera.distance * factor);
			const after = before && camera.groundPoint(...ndc, before[1]);
			if (before && after) camera.pan(before[0] - after[0], before[2] - after[2]);
		};

		/** Smooth zoom toward the ground under (x, y). */
		const glideZoomAt = (x: number, y: number, factor: number) => {
			const point = pick(x, y);
			camera.zoomTo(camera.goalDistance * factor, point ? { ndc: toNdc(x, y), point } : null);
		};

		const recordYaw = (time: number) => {
			yawSamples.push({ time, yaw: camera.yaw });
			while (yawSamples.length > 2 && time - yawSamples[0].time > 100) yawSamples.shift();
		};

		/** Keep turning after a rotate-drag or twist, only if it was still turning when released. */
		const flingYaw = (time: number) => {
			const first = yawSamples[0];
			const last = yawSamples[yawSamples.length - 1];
			yawSamples = [];
			if (!first || first === last || time - last.time > 50) return;
			const seconds = (last.time - first.time) / 1000;
			if (seconds > 0) camera.flingYaw((last.yaw - first.yaw) / seconds);
		};

		const pinchState = () => {
			const [a, b] = [...pointers.values()];
			return {
				x: (a.x + b.x) / 2,
				y: (a.y + b.y) / 2,
				distance: Math.hypot(a.x - b.x, a.y - b.y),
				angle: Math.atan2(b.y - a.y, b.x - a.x)
			};
		};

		const onPointerDown = (event: PointerEvent) => {
			const mouse = event.pointerType === 'mouse';
			const rotateDrag = mouse && (event.button === 2 || (event.button === 0 && event.altKey));
			if (mouse && event.button !== 0 && !rotateDrag) return;
			el.setPointerCapture(event.pointerId);
			camera.stop();
			samples = [];
			yawSamples = [];
			if (rotateDrag) {
				rotating = { id: event.pointerId, x: event.clientX };
				el.classList.add('rotating');
				return;
			}
			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (pointers.size === 1) {
				downAt = { x: event.clientX, y: event.clientY, time: event.timeStamp };
				startGrab(event.clientX, event.clientY);
				el.classList.add('grabbing');
			} else if (pointers.size === 2) {
				const pinch = pinchState();
				pinchDistance = pinch.distance;
				startGrab(pinch.x, pinch.y);
			}
		};

		const onPointerMove = (event: PointerEvent) => {
			if (rotating?.id === event.pointerId) {
				// Dragging right turns the heading right (clockwise seen from above)
				const speed = (options.settings?.rotateSpeed ?? 0.3) * DEG;
				camera.rotate(-(event.clientX - rotating.x) * speed);
				rotating.x = event.clientX;
				recordYaw(event.timeStamp);
				return;
			}
			const pointer = pointers.get(event.pointerId);
			if (!pointer) return;
			if (pointers.size === 1) {
				pointer.x = event.clientX;
				pointer.y = event.clientY;
				dragTo(pointer.x, pointer.y);
				samples.push({ time: event.timeStamp, x: camera.target[0], z: camera.target[2] });
				while (samples.length > 2 && event.timeStamp - samples[0].time > 100) samples.shift();
			} else if (pointers.size === 2) {
				const before = pinchState();
				pointer.x = event.clientX;
				pointer.y = event.clientY;
				const after = pinchState();
				// Around the previous midpoint: zoom, then twist; then move that ground point to the new midpoint
				startGrab(before.x, before.y);
				if (after.distance > 0 && pinchDistance > 0) zoomAt(before.x, before.y, pinchDistance / after.distance);
				pinchDistance = after.distance;
				camera.rotate(wrapAngle(after.angle - before.angle));
				recordYaw(event.timeStamp);
				dragTo(after.x, after.y);
			}
		};

		const onPointerUp = (event: PointerEvent) => {
			if (rotating?.id === event.pointerId) {
				rotating = null;
				el.classList.remove('rotating');
				flingYaw(event.timeStamp);
				return;
			}
			if (!pointers.has(event.pointerId)) return;
			const wasSingle = pointers.size === 1;
			pointers.delete(event.pointerId);

			if (pointers.size === 1) {
				flingYaw(event.timeStamp); // end of a twist
				const [rest] = pointers.values();
				startGrab(rest.x, rest.y); // keep panning with the remaining finger
				samples = [];
				return;
			}
			grab = null;
			el.classList.remove('grabbing');
			if (!wasSingle) return;

			// Fling: only if the pointer was still moving when released
			const last = samples[samples.length - 1];
			const first = samples[0];
			if (last && first && last !== first && event.timeStamp - last.time < 50) {
				const seconds = (last.time - first.time) / 1000;
				if (seconds > 0) camera.fling((last.x - first.x) / seconds, (last.z - first.z) / seconds);
			}

			// Double-tap (touch / pen): two short taps close together zoom in
			const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
			const quick = event.timeStamp - downAt.time < 250;
			if (event.pointerType !== 'mouse' && moved < 10 && quick) {
				const near = Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 30;
				if (near && event.timeStamp - lastTap.time < 300) {
					glideZoomAt(event.clientX, event.clientY, 0.5);
					lastTap.time = -Infinity;
				} else {
					lastTap = { x: event.clientX, y: event.clientY, time: event.timeStamp };
				}
			}
		};

		const onDoubleClick = (event: MouseEvent) => glideZoomAt(event.clientX, event.clientY, 0.5);

		const onWheel = (event: WheelEvent) => {
			event.preventDefault(); // also stops ctrl+wheel (trackpad pinch) from zooming the page
			const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
			const speed = options.settings?.wheelSpeed ?? 0.002;
			glideZoomAt(event.clientX, event.clientY, Math.exp(event.deltaY * scale * speed));
		};

		const onContextMenu = (event: MouseEvent) => event.preventDefault(); // right-drag rotates

		const updateKeys = () => {
			const keys = camera.keys;
			keys.x = keys.y = keys.zoom = keys.rotate = 0;
			for (const binding of pressed.values()) {
				if (binding === 'north') continue;
				const [axis, value] = binding;
				keys[axis] = Math.max(-1, Math.min(1, keys[axis] + value));
			}
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			const binding = KEY_CODES[event.code] ?? KEY_CHARS[event.key];
			if (!binding) return;
			event.preventDefault(); // arrows / page keys would scroll
			if (binding === 'north') {
				if (!event.repeat) camera.resetNorth();
				return;
			}
			pressed.set(event.code, binding);
			updateKeys();
		};

		const onKeyUp = (event: KeyboardEvent) => {
			if (pressed.delete(event.code)) updateKeys();
		};

		const onBlur = () => {
			pressed.clear();
			updateKeys();
		};

		el.addEventListener('pointerdown', onPointerDown);
		el.addEventListener('pointermove', onPointerMove);
		el.addEventListener('pointerup', onPointerUp);
		el.addEventListener('pointercancel', onPointerUp);
		el.addEventListener('dblclick', onDoubleClick);
		el.addEventListener('wheel', onWheel, { passive: false });
		el.addEventListener('contextmenu', onContextMenu);
		el.addEventListener('keydown', onKeyDown);
		el.addEventListener('keyup', onKeyUp);
		el.addEventListener('blur', onBlur);
		return () => {
			el.removeEventListener('pointerdown', onPointerDown);
			el.removeEventListener('pointermove', onPointerMove);
			el.removeEventListener('pointerup', onPointerUp);
			el.removeEventListener('pointercancel', onPointerUp);
			el.removeEventListener('dblclick', onDoubleClick);
			el.removeEventListener('wheel', onWheel);
			el.removeEventListener('contextmenu', onContextMenu);
			el.removeEventListener('keydown', onKeyDown);
			el.removeEventListener('keyup', onKeyUp);
			el.removeEventListener('blur', onBlur);
			onBlur();
		};
	};
}
