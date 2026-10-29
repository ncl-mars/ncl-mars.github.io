import type { Attachment } from 'svelte/attachments';
import { wrapAngle, type CameraPose, type FlightSettings, type GroundHeights, type SurveyCamera } from '$lib/gl/camera';
import { TurnTracker } from '$lib/gl/controls';
import { poiView, type Poi, type StartView } from '$lib/content/pois';

/**
 * Moving between POIs. The first POI is home, framed by the start view; the others are framed relative to
 * it (content/pois.ts). `go(i)` flies the camera to any POI from wherever it is. Leaving home remembers how
 * you left it (your zoom and turn) and coming back returns there; going home from home goes back to the
 * start view. Before the ground has loaded, or with reduced motion, it jumps instead.
 * Lives at module level with the camera, so the current POI survives navigation.
 */
export class Tour {
	current = 0;
	/** Called when the current POI changes (the page mirrors it in UI state). */
	onChange: ((index: number) => void) | null = null;
	/** Called when the camera gets there: end of the flight, or right away after a jump. */
	onArrive: ((index: number) => void) | null = null;
	private homePose: CameraPose | null = null;
	private readonly reducedMotion =
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	constructor(
		readonly camera: SurveyCamera,
		readonly pois: Poi[],
		private readonly ground: () => GroundHeights | null,
		private readonly settings: FlightSettings,
		/** Read live (tuning.start). */
		private readonly start: StartView
	) {
		camera.jumpTo(this.viewOf(0));
	}

	get flying(): boolean {
		return this.camera.flying;
	}

	/** The framed view of POI `index`, from the start view. */
	viewOf(index: number): CameraPose {
		return poiView(this.pois[index], this.start);
	}

	/** `instant`: jump instead of flying (a page opened on a project's URL). */
	go(index: number, instant = false) {
		index = Math.max(0, Math.min(this.pois.length - 1, index));
		let view = this.viewOf(index);
		if (index === 0) {
			if (this.current !== 0 && this.homePose) view = this.homePose;
			else this.homePose = null;
		} else if (this.current === 0 && !this.camera.flying) {
			this.homePose = this.camera.pose();
		}
		const changed = index !== this.current;
		this.current = index;
		if (changed) this.onChange?.(index);
		const arrive = () => this.onArrive?.(index);
		const ground = this.ground();
		if (ground && !instant && !this.reducedMotion) {
			this.camera.flyTo(view, ground, this.settings, arrive);
		} else {
			this.camera.jumpTo(view);
			arrive();
		}
	}

	/** Back to the overview, as you left it. */
	home() {
		if (this.current !== 0) this.go(0);
	}

	/** A label clicked: fly to its POI; the current POI's label goes home (home's own: the start view). */
	select(index: number) {
		this.go(index === this.current ? 0 : index);
	}

	/** The start view was edited (dev panel): show the current POI's new framing at once. */
	reframe() {
		this.homePose = null;
		if (!this.camera.flying) this.camera.jumpTo(this.viewOf(this.current));
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
 * The visitor's input around the current POI, attached to the view element:
 * `<div tabindex="0" {@attach tourControls(tour)}>`. The camera stays on its pivot (the POI's point, or
 * home's): input only turns it and zooms toward it. Moving between POIs is by the labels and the menu.
 * - Drag (any mouse button, one finger): turns, with some inertia on release.
 * - Wheel, trackpad pinch: smooth zoom. Two fingers: pinch zooms, twist turns.
 * - Keyboard (when focused): ← → / Q E turn, ↑ ↓ / + − / Page Up Down zoom, Escape goes home, Home goes
 *   home's start view.
 * Input waits while a flight is under way (the flight owns the camera).
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
			if (event.code !== 'Escape' && event.code !== 'Home') return;
			event.preventDefault();
			if (event.repeat) return;
			if (event.code === 'Escape') tour.home();
			else tour.go(0);
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
