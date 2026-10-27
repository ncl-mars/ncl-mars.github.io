import type { Attachment } from 'svelte/attachments';
import type { SurveyCamera } from './camera';
import type { Vec3 } from '$lib/terrain/heightfield';

/**
 * Pan + zoom for the survey camera, attached to the view element (the canvas ignores pointers):
 * `<div {@attach surveyControls(camera)}>`. Native Pointer Events, no gesture library.
 * - Drag (mouse or one finger) grabs the ground: the point under the pointer stays under it.
 * - Wheel, trackpad pinch (ctrl+wheel) and two-finger pinch zoom toward the pointer / the fingers.
 * Layout is read here, in input events, never in the frame loop. The element needs `touch-action: none`.
 */
export function surveyControls(camera: SurveyCamera): Attachment<HTMLElement> {
	return (el) => {
		const pointers = new Map<number, { x: number; y: number }>();
		let grab: { planeY: number; point: Vec3 } | null = null;
		let pinchDistance = 0;

		const toNdc = (x: number, y: number): [number, number] => {
			const r = el.getBoundingClientRect();
			return [((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2];
		};

		/** Remember the ground point under (x, y), on the horizontal plane through the target. */
		const startGrab = (x: number, y: number) => {
			const planeY = camera.target[1];
			const point = camera.groundPoint(...toNdc(x, y), planeY);
			grab = point ? { planeY, point } : null;
		};

		/** Pan so the grabbed point ends up under (x, y). */
		const dragTo = (x: number, y: number) => {
			if (!grab) return;
			const p = camera.groundPoint(...toNdc(x, y), grab.planeY);
			if (p) camera.pan(grab.point[0] - p[0], grab.point[2] - p[2]);
		};

		/** Change the distance by `factor`, keeping the ground point under (x, y) in place. */
		const zoomAt = (x: number, y: number, factor: number) => {
			const [nx, ny] = toNdc(x, y);
			const planeY = camera.target[1];
			const before = camera.groundPoint(nx, ny, planeY);
			camera.setDistance(camera.distance * factor);
			const after = camera.groundPoint(nx, ny, planeY);
			if (before && after) camera.pan(before[0] - after[0], before[2] - after[2]);
		};

		const pinchState = () => {
			const [a, b] = [...pointers.values()];
			return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
		};

		const onPointerDown = (event: PointerEvent) => {
			if (event.pointerType === 'mouse' && event.button !== 0) return;
			el.setPointerCapture(event.pointerId);
			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (pointers.size === 1) {
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
			if (!pointers.delete(event.pointerId)) return;
			if (pointers.size === 1) {
				const [rest] = pointers.values();
				startGrab(rest.x, rest.y); // keep panning with the remaining finger
			} else if (pointers.size === 0) {
				grab = null;
				el.classList.remove('grabbing');
			}
		};

		const onWheel = (event: WheelEvent) => {
			event.preventDefault(); // also stops ctrl+wheel (trackpad pinch) from zooming the page
			const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
			zoomAt(event.clientX, event.clientY, Math.exp(event.deltaY * scale * 0.0015));
		};

		el.addEventListener('pointerdown', onPointerDown);
		el.addEventListener('pointermove', onPointerMove);
		el.addEventListener('pointerup', onPointerUp);
		el.addEventListener('pointercancel', onPointerUp);
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => {
			el.removeEventListener('pointerdown', onPointerDown);
			el.removeEventListener('pointermove', onPointerMove);
			el.removeEventListener('pointerup', onPointerUp);
			el.removeEventListener('pointercancel', onPointerUp);
			el.removeEventListener('wheel', onWheel);
		};
	};
}
