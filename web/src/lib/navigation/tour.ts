import type { Attachment } from 'svelte/attachments';
import { wrapAngle, type FlightSettings, type GroundHeights, type SurveyCamera } from '$lib/gl/camera';
import { TurnTracker } from '$lib/gl/controls';
import { homeView, type StartView } from '$lib/content/pois';

/**
 * The camera's place: home, the overview framed by the start view (tuning.start). The camera never flies to the
 * POIs: their labels and the menu open the project's card over the scene. The visitor turns and zooms around
 * home's pivot (`tourControls`); `home()` goes back to the start view. Lives at module level with the camera.
 */
export class Tour {
	private readonly reducedMotion =
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	constructor(
		readonly camera: SurveyCamera,
		private readonly ground: () => GroundHeights | null,
		private readonly settings: FlightSettings,
		/** Read live (tuning.start). */
		private readonly start: StartView
	) {
		camera.jumpTo(homeView(start));
	}

	get flying(): boolean {
		return this.camera.flying;
	}

	/** Back to the start view: a flight, or a jump before the ground has loaded or with reduced motion. */
	home() {
		const view = homeView(this.start);
		const ground = this.ground();
		if (ground && !this.reducedMotion) this.camera.flyTo(view, ground, this.settings);
		else this.camera.jumpTo(view);
	}

	/** The start view was edited (dev panel): show it at once. */
	reframe() {
		if (!this.camera.flying) this.camera.jumpTo(homeView(this.start));
	}
}

/** Held keys, by physical position (event.code): turn (+1 turns the heading left) and zoom (−1 in). */
const HELD_KEYS: Record<string, ['rotate' | 'zoom', number]> = {
	ArrowLeft: ['rotate', 1],
	ArrowRight: ['rotate', -1],
	KeyQ: ['rotate', 1],
	KeyE: ['rotate', -1],
	ArrowUp: ['zoom', -1],
	ArrowDown: ['zoom', 1],
	PageUp: ['zoom', -1],
	PageDown: ['zoom', 1],
	NumpadAdd: ['zoom', -1],
	NumpadSubtract: ['zoom', 1]
};
/** Zoom keys by character: '-' is on the 6 key on AZERTY, '+' needs Shift on most layouts. */
const HELD_CHARS: Record<string, ['rotate' | 'zoom', number]> = {
	'+': ['zoom', -1],
	'=': ['zoom', -1],
	'-': ['zoom', 1],
	_: ['zoom', 1]
};

const DEG = Math.PI / 180;

export interface TourControlsOptions {
	/** Checked on every input: false ignores it (a project is open; dev: the free camera has the input). */
	enabled?: () => boolean;
	/** Read live (the dev panel edits them): degrees of turn per pixel dragged, wheel zoom per pixel. */
	settings?: { rotateSpeed: number; wheelSpeed: number };
}

/**
 * The visitor's input, attached to the view element: `<div tabindex="0" {@attach tourControls(tour)}>`. The
 * camera stays on its pivot (the start view's): input only turns it and zooms toward it. The projects open from
 * the labels and the menu.
 * - Drag (any mouse button, one finger): turns, with some inertia on release.
 * - Wheel, trackpad pinch: smooth zoom. Two fingers: pinch zooms, twist turns.
 * - Keyboard (when focused): ← → / Q E turn, ↑ ↓ / + − / Page Up Down zoom, Home goes back to the start view.
 * Input waits while a flight is under way (the flight back to the start view owns the camera).
 */
export function tourControls(tour: Tour, options: TourControlsOptions = {}): Attachment<HTMLElement> {
	return (el) => {
		const enabled = () => options.enabled?.() ?? true;
		const camera = tour.camera;
		const turn = new TurnTracker(camera);
		const pointers = new Map<number, { x: number; y: number }>();
		const held = new Map<string, ['rotate' | 'zoom', number]>(); // by event.code, so keyup releases what keydown pressed

		const pinch = () => {
			const [a, b] = [...pointers.values()];
			return { distance: Math.hypot(a.x - b.x, a.y - b.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
		};

		const onPointerDown = (event: PointerEvent) => {
			// A press on a label is its click: capturing the pointer would steal it
			if (!enabled() || (event.target as Element).closest('button, a')) return;
			if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2) return;
			if (pointers.size >= 2) return;
			el.setPointerCapture(event.pointerId);
			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			turn.clear();
			if (!camera.flying) camera.stop(); // a grab stops a spin or a glide, not a flight
			el.classList.add('rotating');
		};

		const onPointerMove = (event: PointerEvent) => {
			const pointer = pointers.get(event.pointerId);
			if (!pointer) return;
			if (pointers.size === 1) {
				if (!camera.flying) {
					// Dragging right turns the heading right (clockwise seen from above), as in the free controls
					camera.rotate(-(event.clientX - pointer.x) * (options.settings?.rotateSpeed ?? 0.3) * DEG);
					turn.record(event.timeStamp);
				}
				pointer.x = event.clientX;
				pointer.y = event.clientY;
				return;
			}
			const before = pinch();
			pointer.x = event.clientX;
			pointer.y = event.clientY;
			const after = pinch();
			if (camera.flying) return;
			if (after.distance > 0) camera.setDistance((camera.distance * before.distance) / after.distance);
			camera.rotate(wrapAngle(after.angle - before.angle));
			turn.record(event.timeStamp);
		};

		const onPointerUp = (event: PointerEvent) => {
			if (!pointers.delete(event.pointerId)) return;
			if (pointers.size) {
				turn.clear(); // end of a pinch: the remaining finger turns from here
				return;
			}
			el.classList.remove('rotating');
			if (!camera.flying) turn.release(event.timeStamp);
		};

		const onPointerCancel = (event: PointerEvent) => {
			if (!pointers.delete(event.pointerId) || pointers.size) return;
			el.classList.remove('rotating');
			turn.clear();
		};

		const onContextMenu = (event: MouseEvent) => {
			if (enabled()) event.preventDefault(); // right-drag turns
		};

		const onWheel = (event: WheelEvent) => {
			if (!enabled()) return;
			event.preventDefault(); // also stops ctrl+wheel (trackpad pinch) from zooming the page
			if (camera.flying) return;
			const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
			const speed = options.settings?.wheelSpeed ?? 0.002;
			camera.zoomTo(camera.goalDistance * Math.exp(event.deltaY * scale * speed)); // toward the pivot
		};

		const updateHeld = () => {
			const keys = camera.keys;
			keys.rotate = keys.zoom = 0;
			for (const [axis, value] of held.values()) keys[axis] = Math.max(-1, Math.min(1, keys[axis] + value));
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (!enabled() || event.ctrlKey || event.metaKey || event.altKey) return;
			const binding = HELD_KEYS[event.code] ?? HELD_CHARS[event.key];
			if (binding) {
				event.preventDefault(); // arrows / page keys would scroll
				held.set(event.code, binding);
				updateHeld();
				return;
			}
			if (event.code !== 'Home') return;
			event.preventDefault();
			if (!event.repeat) tour.home();
		};

		const onKeyUp = (event: KeyboardEvent) => {
			if (held.delete(event.code)) updateHeld();
		};

		const onBlur = () => {
			if (!held.size) return;
			held.clear();
			updateHeld();
		};

		el.addEventListener('pointerdown', onPointerDown);
		el.addEventListener('pointermove', onPointerMove);
		el.addEventListener('pointerup', onPointerUp);
		el.addEventListener('pointercancel', onPointerCancel);
		el.addEventListener('contextmenu', onContextMenu);
		el.addEventListener('wheel', onWheel, { passive: false });
		el.addEventListener('keydown', onKeyDown);
		el.addEventListener('keyup', onKeyUp);
		el.addEventListener('blur', onBlur);
		return () => {
			el.removeEventListener('pointerdown', onPointerDown);
			el.removeEventListener('pointermove', onPointerMove);
			el.removeEventListener('pointerup', onPointerUp);
			el.removeEventListener('pointercancel', onPointerCancel);
			el.removeEventListener('contextmenu', onContextMenu);
			el.removeEventListener('wheel', onWheel);
			el.removeEventListener('keydown', onKeyDown);
			el.removeEventListener('keyup', onKeyUp);
			el.removeEventListener('blur', onBlur);
			onBlur();
		};
	};
}
