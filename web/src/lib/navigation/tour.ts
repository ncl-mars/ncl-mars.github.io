import type { Attachment } from 'svelte/attachments';
import type { FlightSettings, GroundHeights, SurveyCamera } from '$lib/gl/camera';
import { TurnTracker } from '$lib/gl/controls';
import type { Poi } from '$lib/content/pois';

/**
 * Moving between POIs: `go(i)` flies the camera to any POI from wherever it is (going to the current one
 * flies back to its framing); `next` / `previous` step through them in order. Before the ground has
 * loaded, or with reduced motion, it jumps instead. Lives at module level with the camera, so the current
 * POI survives navigation.
 */
export class Tour {
	current = 0;
	/** Called when the current POI changes (the page mirrors it in UI state). */
	onChange: ((index: number) => void) | null = null;
	/** Called when the camera gets there: end of the flight, or right away after a jump. */
	onArrive: ((index: number) => void) | null = null;
	private readonly reducedMotion =
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	constructor(
		readonly camera: SurveyCamera,
		readonly pois: Poi[],
		private readonly ground: () => GroundHeights | null,
		private readonly settings: FlightSettings
	) {
		camera.jumpTo(pois[0].view);
	}

	get flying(): boolean {
		return this.camera.flying;
	}

	/** `instant`: jump instead of flying (a page opened on a project's URL). */
	go(index: number, instant = false) {
		index = Math.max(0, Math.min(this.pois.length - 1, index));
		const changed = index !== this.current;
		this.current = index;
		if (changed) this.onChange?.(index);
		const arrive = () => this.onArrive?.(index);
		const ground = this.ground();
		if (ground && !instant && !this.reducedMotion) {
			this.camera.flyTo(this.pois[index].view, ground, this.settings, arrive);
		} else {
			this.camera.jumpTo(this.pois[index].view);
			arrive();
		}
	}

	/** A label clicked: fly to its POI; clicking the current one again goes back to the overview (the first POI). */
	select(index: number) {
		this.go(index === this.current ? 0 : index);
	}

	next() {
		if (this.current < this.pois.length - 1) this.go(this.current + 1);
	}

	previous() {
		if (this.current > 0) this.go(this.current - 1);
	}
}

/** Wheel events closer than this (ms) belong to the same gesture (trackpad momentum included). */
const GESTURE_GAP = 200;
/** Wheel distance (px) for one step: one mouse notch, or a short trackpad swipe. */
const WHEEL_STEP = 40;
/** Touch swipe distance (px) for one step. */
const SWIPE_STEP = 40;
/** Touch movement (px) before a drag picks its axis: across turns the view, along steps. */
const AXIS_LOCK = 10;
/** Turning keys by physical position (event.code): Q / E, A / E on AZERTY. +1 turns the heading left. */
const TURN_KEYS: Record<string, number> = { KeyQ: 1, KeyE: -1 };

const DEG = Math.PI / 180;

export interface TourControlsOptions {
	/** Checked on every input: false ignores it (dev: the free camera has the input). */
	enabled?: () => boolean;
	/** Read live (the dev panel edits it): degrees of turn per pixel dragged. */
	settings?: { rotateSpeed: number };
}

/**
 * Input for the tour, attached to the view element: `<div tabindex="0" {@attach tourControls(tour)}>`.
 * - Wheel / trackpad: one step per gesture (down = next), so momentum never skips POIs. A new gesture
 *   during a flight re-targets it.
 * - Mouse drag (any button): turns the view around the current POI, with some inertia on release.
 * - Touch: a drag across turns, a swipe up = next, down = previous (the first pixels pick the axis).
 * - Keyboard (when focused): → ↓ Page Down Space = next, ← ↑ Page Up = previous, Home / End; Q / E turn.
 * Turning waits while a flight is under way (the flight owns the heading). Clicking a label (Legend)
 * calls `tour.select(i)` itself.
 */
export function tourControls(tour: Tour, options: TourControlsOptions = {}): Attachment<HTMLElement> {
	return (el) => {
		const enabled = () => options.enabled?.() ?? true;
		const camera = tour.camera;
		const turn = new TurnTracker(camera);
		let lastWheel = -Infinity;
		let wheelSum = 0;
		let stepped = false;
		// x, y: where the drag started; while turning, x is the last position
		let drag: { id: number; x: number; y: number; mode: 'pending' | 'turn' | 'swipe' } | null = null;
		const turnKeys = new Set<string>();

		const onWheel = (event: WheelEvent) => {
			if (!enabled()) return;
			event.preventDefault();
			if (event.timeStamp - lastWheel > GESTURE_GAP) {
				wheelSum = 0;
				stepped = false;
			}
			lastWheel = event.timeStamp;
			if (stepped) return;
			const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
			wheelSum += event.deltaY * scale;
			if (Math.abs(wheelSum) < WHEEL_STEP) return;
			stepped = true;
			if (wheelSum > 0) tour.next();
			else tour.previous();
		};

		const onPointerDown = (event: PointerEvent) => {
			// A press on a label is its click: capturing the pointer would steal it
			if (!enabled() || drag || (event.target as Element).closest('button, a')) return;
			const mouse = event.pointerType === 'mouse';
			if (mouse && event.button !== 0 && event.button !== 2) return;
			el.setPointerCapture(event.pointerId);
			drag = { id: event.pointerId, x: event.clientX, y: event.clientY, mode: mouse ? 'turn' : 'pending' };
			turn.clear();
			if (!camera.flying) camera.stop(); // a grab stops a spin, not a flight
			if (mouse) el.classList.add('rotating');
		};

		const onPointerMove = (event: PointerEvent) => {
			if (drag?.id !== event.pointerId) return;
			if (drag.mode === 'pending') {
				const dx = event.clientX - drag.x;
				const dy = event.clientY - drag.y;
				if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK) return;
				drag.mode = Math.abs(dx) > Math.abs(dy) ? 'turn' : 'swipe';
				drag.x = event.clientX;
				return;
			}
			if (drag.mode !== 'turn') return;
			if (!camera.flying) {
				// Dragging right turns the heading right (clockwise seen from above), as in the free controls
				camera.rotate(-(event.clientX - drag.x) * (options.settings?.rotateSpeed ?? 0.3) * DEG);
				turn.record(event.timeStamp);
			}
			drag.x = event.clientX;
		};

		const onPointerUp = (event: PointerEvent) => {
			if (drag?.id !== event.pointerId) return;
			const { mode, y } = drag;
			drag = null;
			el.classList.remove('rotating');
			if (mode === 'turn') {
				if (!camera.flying) turn.release(event.timeStamp);
			} else if (mode === 'swipe') {
				const dy = event.clientY - y;
				if (dy <= -SWIPE_STEP) tour.next();
				else if (dy >= SWIPE_STEP) tour.previous();
			}
		};

		const onPointerCancel = (event: PointerEvent) => {
			if (drag?.id !== event.pointerId) return;
			drag = null;
			el.classList.remove('rotating');
			turn.clear();
		};

		const onContextMenu = (event: MouseEvent) => {
			if (enabled()) event.preventDefault(); // right-drag turns
		};

		const updateTurnKeys = () => {
			let rotate = 0;
			for (const code of turnKeys) rotate += TURN_KEYS[code];
			camera.keys.rotate = rotate;
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (!enabled() || event.ctrlKey || event.metaKey || event.altKey) return;
			if (event.code in TURN_KEYS) {
				event.preventDefault();
				turnKeys.add(event.code);
				updateTurnKeys();
				return;
			}
			// Space on a focused label is its click
			if (event.code === 'Space' && (event.target as HTMLElement).closest('button, a')) return;
			let action: (() => void) | null = null;
			switch (event.code) {
				case 'ArrowRight':
				case 'ArrowDown':
				case 'PageDown':
				case 'Space':
					action = () => tour.next();
					break;
				case 'ArrowLeft':
				case 'ArrowUp':
				case 'PageUp':
					action = () => tour.previous();
					break;
				case 'Home':
					action = () => tour.go(0);
					break;
				case 'End':
					action = () => tour.go(tour.pois.length - 1);
					break;
			}
			if (!action) return;
			event.preventDefault(); // these keys would scroll
			if (!event.repeat) action();
		};

		const onKeyUp = (event: KeyboardEvent) => {
			if (turnKeys.delete(event.code)) updateTurnKeys();
		};

		const onBlur = () => {
			if (!turnKeys.size) return;
			turnKeys.clear();
			updateTurnKeys();
		};

		el.addEventListener('wheel', onWheel, { passive: false });
		el.addEventListener('pointerdown', onPointerDown);
		el.addEventListener('pointermove', onPointerMove);
		el.addEventListener('pointerup', onPointerUp);
		el.addEventListener('pointercancel', onPointerCancel);
		el.addEventListener('contextmenu', onContextMenu);
		el.addEventListener('keydown', onKeyDown);
		el.addEventListener('keyup', onKeyUp);
		el.addEventListener('blur', onBlur);
		return () => {
			el.removeEventListener('wheel', onWheel);
			el.removeEventListener('pointerdown', onPointerDown);
			el.removeEventListener('pointermove', onPointerMove);
			el.removeEventListener('pointerup', onPointerUp);
			el.removeEventListener('pointercancel', onPointerCancel);
			el.removeEventListener('contextmenu', onContextMenu);
			el.removeEventListener('keydown', onKeyDown);
			el.removeEventListener('keyup', onKeyUp);
			el.removeEventListener('blur', onBlur);
			onBlur();
		};
	};
}
