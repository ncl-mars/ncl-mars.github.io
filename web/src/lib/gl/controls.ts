import type { Attachment } from 'svelte/attachments';
import type { SurveyCamera } from './camera';
import type { Heightfield, Vec3 } from '$lib/terrain/heightfield';

export interface SurveyControlsOptions {
	/** The CPU heightfield once loaded: grabs and zooms anchor on the real ground under the pointer. */
	field?: () => Heightfield | null;
}

/** Keys → [axis, direction]. QWERTY (WASD), AZERTY (ZQSD) and arrows; +/− and Page Up/Down zoom. */
const KEYS: Record<string, ['x' | 'y' | 'zoom', number]> = {
	arrowup: ['y', 1],
	w: ['y', 1],
	z: ['y', 1],
	arrowdown: ['y', -1],
	s: ['y', -1],
	arrowleft: ['x', -1],
	a: ['x', -1],
	q: ['x', -1],
	arrowright: ['x', 1],
	d: ['x', 1],
	'+': ['zoom', -1],
	'=': ['zoom', -1],
	pageup: ['zoom', -1],
	'-': ['zoom', 1],
	pagedown: ['zoom', 1]
};

/**
 * Input for the survey camera, attached to the view element (the canvas ignores pointers):
 * `<div tabindex="0" {@attach surveyControls(camera, { field })}>`. Native Pointer Events.
 * - Drag (mouse, one finger) grabs the ground: the point under the pointer stays under it. Releasing
 *   while moving leaves some inertia.
 * - Wheel and trackpad pinch: smooth zoom toward the pointer. Two-finger pinch: direct zoom + pan.
 * - Double-click / double-tap: zoom in toward that point.
 * - Keyboard (when the element has focus): arrows / WASD / ZQSD pan, +/− zoom.
 * Layout is read here, in input events, never in the frame loop. The element needs `touch-action: none`.
 */
export function surveyControls(camera: SurveyCamera, options: SurveyControlsOptions = {}): Attachment<HTMLElement> {
	return (el) => {
		const pointers = new Map<number, { x: number; y: number }>();
		let grab: { planeY: number; point: Vec3 } | null = null;
		let pinchDistance = 0;
		// Recent target positions while dragging, to compute the release velocity
		let samples: { time: number; x: number; z: number }[] = [];
		let downAt = { x: 0, y: 0, time: 0 };
		let lastTap = { x: 0, y: 0, time: -Infinity };
		const pressed = new Set<string>();

		const toNdc = (x: number, y: number): [number, number] => {
			const r = el.getBoundingClientRect();
			return [((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2];
		};

		/** The ground under (x, y): a CPU raycast when the heightfield is loaded, else the target's plane. */
		const pick = (x: number, y: number): Vec3 | null => {
			const ndc = toNdc(x, y);
			const field = options.field?.();
			if (field) {
				const { origin, direction } = camera.ray(...ndc);
				const hit = field.raycast(origin, direction);
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

		const pinchState = () => {
			const [a, b] = [...pointers.values()];
			return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
		};

		const onPointerDown = (event: PointerEvent) => {
			if (event.pointerType === 'mouse' && event.button !== 0) return;
			el.setPointerCapture(event.pointerId);
			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			camera.stop();
			samples = [];
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
				// Zoom around the previous midpoint, then move that ground point to the new midpoint
				startGrab(before.x, before.y);
				if (after.distance > 0 && pinchDistance > 0) zoomAt(before.x, before.y, pinchDistance / after.distance);
				pinchDistance = after.distance;
				dragTo(after.x, after.y);
			}
		};

		const onPointerUp = (event: PointerEvent) => {
			const pointer = pointers.get(event.pointerId);
			if (!pointer) return;
			const wasSingle = pointers.size === 1;
			pointers.delete(event.pointerId);

			if (pointers.size === 1) {
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
			glideZoomAt(event.clientX, event.clientY, Math.exp(event.deltaY * scale * 0.002));
		};

		const updateKeys = () => {
			camera.keys.x = camera.keys.y = camera.keys.zoom = 0;
			for (const key of pressed) {
				const [axis, value] = KEYS[key];
				camera.keys[axis] = clamp(camera.keys[axis] + value, -1, 1);
			}
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			const key = event.key.toLowerCase();
			if (!(key in KEYS)) return;
			event.preventDefault(); // arrows / page keys would scroll
			pressed.add(key);
			updateKeys();
		};

		const onKeyUp = (event: KeyboardEvent) => {
			if (pressed.delete(event.key.toLowerCase())) updateKeys();
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
			el.removeEventListener('keydown', onKeyDown);
			el.removeEventListener('keyup', onKeyUp);
			el.removeEventListener('blur', onBlur);
			onBlur();
		};
	};
}

function clamp(v: number, lo: number, hi: number) {
	return v < lo ? lo : v > hi ? hi : v;
}
