import type { SurveyCamera } from '$lib/gl/camera';
import type { Frame } from '$lib/gl/types';
import type { Ground } from '$lib/terrain/ground';
import type { Vec3 } from '$lib/terrain/heightfield';
import { fogAmount, type FogSettings, type MistSettings } from '$lib/terrain/atmosphere';
import { LegendLines } from './lines';

export interface LegendItem {
	/** Short label, above the shelf. */
	title: string;
	/** The ground point the line comes from (world x, z); its height comes from the ground. */
	at: [number, number];
	/** Line under the shelf. Default: the point's survey coordinates. */
	meta?: string;
}

/**
 * Read live (tuning.legend). See schema.ts. `scale` is the text size in rem; rise, spacing and anchorSize are
 * in em of it, so it sizes the whole legend; on narrow screens it is multiplied by `smallScale`. `stroke`
 * stays in CSS px (a hairline at any scale).
 */
export interface LegendSettings {
	layout: number;
	scale: number;
	smallScale: number;
	opacity: number;
	stroke: number;
	anchorSize: number;
	rise: number;
	angle: number;
	column: number;
	spacing: number;
	follow: number;
	flightFollow: number;
	lift: number;
	occlusionLift: number;
	fogCutoff: number;
	mistFloor: number;
	drawTime: number;
	stagger: number;
}

/** One item's elements, rendered by Legend.svelte. */
export interface LegendElements {
	group: SVGGElement;
	line: SVGPolylineElement;
	dot: SVGCircleElement;
	label: HTMLElement;
	title: HTMLElement;
	meta: HTMLElement;
}

const DEG = Math.PI / 180;
/** Anchors closer than this to the view's edges count as off-screen, and labels keep this margin (CSS px). */
const EDGE = 16;
/** Shortest horizontal run from an anchor to its label (column layout), in em. */
const MIN_RUN = 1.5;
/** Samples along the anchor → eye segment for the terrain occlusion test. */
const OCCLUSION_SAMPLES = 24;
/** Where `smallScale` applies (phones). */
const NARROW = '(max-width: 700px)';
/**
 * A label's box around its shelf line, in em (Legend.svelte's CSS): the title above, the coordinates
 * below; and the gap kept between two labels.
 */
const BOX_ABOVE = 1.75;
const BOX_BELOW = 1.6;
const BOX_GAP = 0.35;

interface Box {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

class Mark {
	readonly world: Vec3 = [0, Number.NaN, 0];
	/** Anchor on screen, CSS px from the view's top-left. */
	x = 0;
	y = 0;
	/** Where the shelf starts (the label's corner on the line). */
	labelX = 0;
	labelY = 0;
	/** Relaxed label height (column layout), before smoothing. */
	target = 0;
	/** Extra rise out of other labels' way (callout layout), eased, CSS px. */
	lift = 0;
	/** From the camera to the anchor, world units: nearer labels keep their place. */
	distance = 0;
	/** 1: label to the right of its anchor, −1: to the left, 0: not placed yet. */
	side: -1 | 0 | 1 = 0;
	placed = false;
	/** Label width (widest of title and meta), from the ResizeObserver. */
	width = 0;
	titleWidth = 0;
	metaWidth = 0;
	/** Reveal progress, 0 hidden → 1 fully drawn. Starts negative for the stagger. */
	t = 0;
	visible = false;
	occluded = false;
	/** Label opacity from the atmosphere's cover at the anchor (1 clear, 0 lost in the mist). */
	clear = 1;
	/** The anchor is in front of the camera, at this depth (NDC z): the line's plane, for its 3D copy. */
	inFront = false;
	ndcZ = 0;
	/** The polyline as last drawn (CSS px): elbow x, shelf y, shelf start and end x, and the part drawn so far (0..1). */
	elbowX = 0;
	lineY = 0;
	shelfX = 0;
	endX = 0;
	drawn = 0;
	/** The text's fade in (0..1), after the line. */
	textFade = 0;

	// Last values written to the DOM: write only on change
	hidden = true;
	points = '';
	dash = '';
	dotKey = '';
	opacity = '';
	transform = '';
	text = '';
	shownSide: -1 | 0 | 1 = 0;

	constructor(
		readonly item: LegendItem,
		readonly el: LegendElements,
		readonly index: number
	) {}
}

/**
 * Legend lines: HTML labels over the 3D, each tied to a ground point by a hairline with one elbow, like the
 * callouts of a technical drawing. Runs from `renderer.onFrame()`: projects the anchors through the camera,
 * lays the labels out, and writes SVG attributes and styles directly, only when they change. Layout is never
 * read in the frame loop: sizes come from a ResizeObserver.
 *
 * - Layout 0 (callout): the label sits beside its point, a diagonal then the shelf; it flips side to stay in
 *   the view. Labels are placed nearest first: one that would overlap a label already placed rises above
 *   it, eased, its diagonal getting longer.
 * - Layout 1 (columns): labels stand in a column on each side, sorted by height and kept apart; only their
 *   height follows the anchor, smoothed, so the text stays calm while the camera moves.
 *
 * Labels hide when their point leaves the view or goes well behind the terrain (tested from `occlusionLift`
 * above it), and fade with the mist (the same fog as the scene), down to `mistFloor`; the line draws itself
 * from the anchor to the end of the shelf, then the text fades in.
 */
export class Legend {
	/** Labels currently on screen (dev readout). */
	shown = 0;
	/** Called when the screen crosses the narrow breakpoint: the text size (`textScale`) changed. */
	onScaleChange: (() => void) | null = null;

	private readonly narrowQuery: MediaQueryList;
	private narrow: boolean;
	private readonly marks: Mark[];
	private readonly byElement = new Map<Element, Mark>();
	private readonly observer: ResizeObserver;
	private readonly reducedMotion: boolean;
	private readonly left: Mark[] = [];
	private readonly right: Mark[] = [];
	private readonly order: Mark[] = [];
	private readonly boxes: Box[] = [];
	private width = 0;
	private height = 0;
	/** CSS px per rem, read outside the frame loop (constructor, resize). */
	private rootFontSize = 16;
	private revision = -1;
	private layout = -1;
	private occlusionLift = Number.NaN;

	constructor(
		private readonly root: HTMLElement,
		items: LegendItem[],
		elements: LegendElements[],
		private readonly camera: SurveyCamera,
		private readonly ground: () => Ground | null,
		private readonly settings: LegendSettings,
		private readonly fog: FogSettings,
		private readonly mist: MistSettings & { height: number },
		/** Where to write the lines in 3D for their shadows in the scene, if anywhere (lines.ts). */
		private readonly lines: LegendLines | null = null
	) {
		this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
		this.narrowQuery = matchMedia(NARROW);
		this.narrow = this.narrowQuery.matches;
		this.narrowQuery.addEventListener('change', this.onNarrowChange);
		this.readRootFontSize();
		this.marks = items.map((item, i) => {
			const mark = new Mark(item, elements[i], i);
			// Staggered first reveal
			if (settings.drawTime > 0 && !this.reducedMotion) mark.t = (-i * settings.stagger) / settings.drawTime;
			this.byElement.set(mark.el.title, mark);
			this.byElement.set(mark.el.meta, mark);
			return mark;
		});
		// The labels' fonts and text box, for their shadows' masks (read once, outside the frame loop)
		if (lines && this.marks.length) {
			const { title, meta } = this.marks[0].el;
			lines.fonts = { sans: getComputedStyle(title).fontFamily, mono: getComputedStyle(meta).fontFamily };
			lines.box = { above: BOX_ABOVE, below: BOX_BELOW };
		}

		this.observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				if (entry.target === root) {
					this.width = entry.contentRect.width;
					this.height = entry.contentRect.height;
					this.readRootFontSize();
					continue;
				}
				const mark = this.byElement.get(entry.target);
				if (!mark) continue;
				const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
				if (entry.target === mark.el.title) mark.titleWidth = width;
				else mark.metaWidth = width;
				mark.width = Math.max(mark.titleWidth, mark.metaWidth);
			}
		});
		this.observer.observe(root);
		for (const mark of this.marks) {
			this.observer.observe(mark.el.title);
			this.observer.observe(mark.el.meta);
		}
	}

	dispose() {
		this.observer.disconnect();
		this.narrowQuery.removeEventListener('change', this.onNarrowChange);
		if (this.lines) this.lines.count = this.lines.labelCount = 0;
	}

	/** Text size in rem: `scale`, times `smallScale` on narrow screens. Rise, spacing, anchor ring are in em of it. */
	textScale(): number {
		const s = this.settings;
		return s.scale * (this.narrow ? s.smallScale : 1);
	}

	private onNarrowChange = (event: MediaQueryListEvent) => {
		this.narrow = event.matches;
		this.onScaleChange?.();
	};

	private readRootFontSize() {
		this.rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
	}

	update = (frame: Frame) => {
		const ground = this.ground();
		const { width, height } = this;
		if (!ground || width === 0 || height === 0) return;
		const s = this.settings;
		const camera = this.camera;
		const vp = camera.viewProjection;
		const eye = camera.eye;
		const cameraMoved = camera.revision !== this.revision;
		this.revision = camera.revision;
		const step = s.drawTime > 0 && !this.reducedMotion ? frame.dt / s.drawTime : 1;
		const mistBase = ground.slab[0] + this.mist.height;

		const layout = s.layout >= 1 ? 1 : 0;
		if (layout !== this.layout) {
			this.layout = layout;
			for (const mark of this.marks) mark.side = 0;
		}

		// The occlusion lift was edited (panel): test again, even with a still camera
		const retest = s.occlusionLift !== this.occlusionLift;
		this.occlusionLift = s.occlusionLift;

		this.shown = 0;
		for (const mark of this.marks) {
			const p = mark.world;
			const [x, z] = mark.item.at;
			const groundHeight = ground.heightAt(x, z);
			const moved = groundHeight + s.lift !== p[1];
			if (moved) {
				p[0] = x;
				p[1] = groundHeight + s.lift;
				p[2] = z;
				if (mark.item.meta === undefined) mark.el.meta.textContent = surveyCoordinates(x, z, groundHeight);
			}

			// Project (column-major view-projection), into CSS px from the view's top-left
			const cx = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
			const cy = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
			const cz = vp[2] * p[0] + vp[6] * p[1] + vp[10] * p[2] + vp[14];
			const cw = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
			const inFront = cw > 1e-3;
			mark.inFront = inFront;
			if (inFront) {
				// Behind the camera, keep the last position so a hiding label retracts where it was
				mark.x = ((cx / cw) * 0.5 + 0.5) * width;
				mark.y = (0.5 - (cy / cw) * 0.5) * height;
				mark.ndcZ = cz / cw;
			}
			const onScreen =
				inFront && mark.x > EDGE && mark.x < width - EDGE && mark.y > EDGE && mark.y < height - EDGE;
			if (cameraMoved || moved || retest) mark.occluded = onScreen && occluded(ground, p, s.occlusionLift, eye);
			mark.distance = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
			// Fades with the mist, never under the floor: a label stays readable in a thick bank
			const cutoff = Math.max(0.05, s.fogCutoff);
			const cover = smoothstep(cutoff * 0.5, cutoff, fogAmount(eye, p, this.fog, this.mist, mistBase));
			mark.clear = Math.max(Math.min(1, Math.max(0, s.mistFloor)), 1 - cover);
			mark.visible = onScreen && !mark.occluded && mark.clear > 0.02;

			if (mark.visible) mark.t = Math.min(1, mark.t + step);
			else if (mark.t > 0) mark.t = Math.max(0, mark.t - step * 1.5);
			if (mark.t > 0) this.shown++;
		}

		const em = this.textScale() * this.rootFontSize;
		const tan = Math.tan(Math.min(Math.max(s.angle, 5), 89.9) * DEG);
		if (layout === 1) this.layoutColumns(frame.dt, em);
		else this.layoutCallouts(frame.dt, em, tan);
		for (const mark of this.marks) this.draw(mark, tan, em);
		if (this.lines) {
			this.exportLines(this.lines);
			this.exportLabels(this.lines, em);
		}
	};

	/**
	 * The shown labels' text boxes in 3D, for their shadows (lines.ts), unprojected like the lines; and their
	 * text, for the masks (its revision bumped only when it changes).
	 */
	private exportLabels(lines: LegendLines, em: number) {
		const inv = this.camera.inverseViewProjection;
		const { width, height } = this;
		const data = lines.labels;
		const stroke = this.settings.stroke;
		let n = 0;
		for (const mark of this.marks) {
			if (n >= lines.labelCapacity || mark.index >= lines.labelCapacity) break;
			if (mark.t <= 0 || mark.textFade <= 0 || !mark.inFront || mark.width <= 0) continue;
			const side = mark.side || 1;
			const left = side === 1 ? mark.shelfX : mark.shelfX - mark.width;
			const top = mark.lineY - stroke / 2 - BOX_ABOVE * em;
			const bottom = mark.lineY - stroke / 2 + BOX_BELOW * em;
			unproject(inv, left, top, mark.ndcZ, width, height, ELBOW);
			unproject(inv, left + mark.width, top, mark.ndcZ, width, height, END);
			unproject(inv, left, bottom, mark.ndcZ, width, height, PROBE);
			const o = n++ * LegendLines.LABEL_STRIDE;
			for (let k = 0; k < 3; k++) {
				data[o + k] = ELBOW[k];
				data[o + 3 + k] = END[k] - ELBOW[k];
				data[o + 6 + k] = PROBE[k] - ELBOW[k];
			}
			data[o + 9] = mark.index;
			data[o + 10] = mark.textFade * mark.clear;

			const title = mark.item.title;
			const meta = mark.el.meta.textContent ?? '';
			let text = lines.texts[mark.index];
			if (!text) text = lines.texts[mark.index] = { title, meta, size: em, side, width: mark.width, revision: 0 };
			else if (
				text.title !== title ||
				text.meta !== meta ||
				text.size !== em ||
				text.side !== side ||
				text.width !== mark.width
			) {
				Object.assign(text, { title, meta, size: em, side, width: mark.width });
				text.revision++;
			}
		}
		lines.labelCount = n;
	}

	/**
	 * The shown labels' lines in 3D, for their shadows (lines.ts): each screen point unprojected at its
	 * anchor's depth, so the copy lies on a plane facing the camera, exactly under the drawn line; only the
	 * part drawn so far.
	 */
	private exportLines(lines: LegendLines) {
		const inv = this.camera.inverseViewProjection;
		const { width, height } = this;
		const data = lines.data;
		let n = 0;
		const push = (a: Vec3, b: Vec3, f: number, pixel: number, visibility: number) => {
			if (n >= lines.capacity || f <= 0) return;
			const o = n++ * LegendLines.STRIDE;
			data[o] = a[0];
			data[o + 1] = a[1];
			data[o + 2] = a[2];
			data[o + 3] = a[0] + (b[0] - a[0]) * f;
			data[o + 4] = a[1] + (b[1] - a[1]) * f;
			data[o + 5] = a[2] + (b[2] - a[2]) * f;
			data[o + 6] = pixel;
			data[o + 7] = visibility;
		};
		for (const mark of this.marks) {
			if (mark.t <= 0 || mark.drawn <= 0 || !mark.inFront) continue;
			unproject(inv, mark.elbowX, mark.lineY, mark.ndcZ, width, height, ELBOW);
			unproject(inv, mark.endX, mark.lineY, mark.ndcZ, width, height, END);
			unproject(inv, mark.x + 1, mark.y, mark.ndcZ, width, height, PROBE);
			const a = mark.world;
			const pixel = Math.hypot(PROBE[0] - a[0], PROBE[1] - a[1], PROBE[2] - a[2]);
			// The line draws itself from the anchor: up the diagonal, then along the shelf
			const diagonal = Math.hypot(mark.elbowX - mark.x, mark.lineY - mark.y);
			const shelf = Math.abs(mark.endX - mark.elbowX);
			const drawn = (diagonal + shelf) * mark.drawn;
			push(a, ELBOW, diagonal > 0 ? Math.min(1, drawn / diagonal) : 1, pixel, mark.clear);
			if (shelf > 0) push(ELBOW, END, (drawn - diagonal) / shelf, pixel, mark.clear);
		}
		lines.count = n;
	}

	/** How fast labels ease to their new heights: `flightFollow` while the camera flies (back to the start view). */
	private get followRate(): number {
		return this.camera.flying ? this.settings.flightFollow : this.settings.follow;
	}

	/**
	 * Each label beside its anchor: up the diagonal, then the shelf, on the side where it fits. Nearest first;
	 * a label overlapping one already placed rises above it. Boxes use the target heights, so the order is
	 * settled every frame; the lift itself is eased (`followRate`).
	 */
	private layoutCallouts(dt: number, em: number, tan: number) {
		const s = this.settings;
		const rise = s.rise * em;
		const run = rise / tan;
		const gap = BOX_GAP * em;
		const k = 1 - Math.exp(-dt * this.followRate);

		const order = this.order;
		order.length = 0;
		for (const mark of this.marks) if (mark.t > 0) order.push(mark);
		order.sort((a, b) => a.distance - b.distance);

		const boxes = this.boxes;
		boxes.length = 0;
		for (const mark of order) {
			const fitsRight = mark.x + run + mark.width + EDGE <= this.width;
			const fitsLeft = mark.x - run - mark.width - EDGE >= 0;
			if (mark.side === 0) mark.side = fitsRight || !fitsLeft ? 1 : -1;
			else if (mark.side === 1 ? !fitsRight && fitsLeft : !fitsLeft && fitsRight) mark.side = mark.side === 1 ? -1 : 1;
			mark.labelX = mark.x + mark.side * run;

			const left = mark.side === 1 ? mark.labelX : mark.labelX - mark.width;
			const right = left + mark.width;
			const above = BOX_ABOVE * em;
			const below = BOX_BELOW * em;
			// Up above every placed label it would overlap, until it overlaps none (it only rises: this ends)
			let y = mark.y - rise;
			for (let pass = 0; pass <= boxes.length; pass++) {
				let moved = false;
				for (const box of boxes) {
					if (right + gap <= box.left || left - gap >= box.right) continue;
					if (y - above >= box.bottom + gap || y + below + gap <= box.top) continue;
					y = box.top - gap - below;
					moved = true;
				}
				if (!moved) break;
			}
			boxes.push({ left, right, top: y - above, bottom: y + below });

			const target = mark.y - rise - y;
			mark.lift = mark.placed ? mark.lift + (target - mark.lift) * k : target;
			mark.labelY = mark.y - rise - mark.lift;
		}
	}

	/** Labels in two columns, on the side of their anchor, sorted by height and kept `spacing` apart. */
	private layoutColumns(dt: number, em: number) {
		const half = this.width / 2;
		const band = this.width * 0.04; // hysteresis around the middle, so a label doesn't flip back and forth
		const left = this.left;
		const right = this.right;
		left.length = 0;
		right.length = 0;
		for (const mark of this.marks) {
			if (mark.t <= 0) continue;
			if (mark.side === 0 || !mark.placed) mark.side = mark.x < half ? -1 : 1;
			else if (mark.side === 1 && mark.x < half - band) mark.side = -1;
			else if (mark.side === -1 && mark.x > half + band) mark.side = 1;
			mark.target = mark.y - this.settings.rise * em;
			(mark.side === 1 ? right : left).push(mark);
		}
		this.relax(left, dt, em);
		this.relax(right, dt, em);
	}

	private relax(column: Mark[], dt: number, em: number) {
		const s = this.settings;
		const gap = s.spacing * em;
		const top = EDGE + gap * 0.5;
		const bottom = this.height - EDGE - gap * 0.5;
		column.sort((a, b) => a.target - b.target);
		let previous = -Infinity;
		for (const mark of column) previous = mark.target = Math.max(mark.target, previous + gap, top);
		previous = Infinity;
		for (let i = column.length - 1; i >= 0; i--) {
			const mark = column[i];
			previous = mark.target = Math.min(mark.target, previous - gap, bottom);
		}

		const k = 1 - Math.exp(-dt * this.followRate);
		for (const mark of column) {
			mark.labelY = mark.placed ? mark.labelY + (mark.target - mark.labelY) * k : mark.target;
			const attach = mark.side === 1 ? this.width * (1 - s.column) : this.width * s.column;
			const run = MIN_RUN * em;
			mark.labelX = mark.side === 1 ? Math.max(attach, mark.x + run) : Math.min(attach, mark.x - run);
		}
	}

	private draw(mark: Mark, tan: number, em: number) {
		const s = this.settings;
		const el = mark.el;
		const hidden = mark.t <= 0;
		if (hidden !== mark.hidden) {
			mark.hidden = hidden;
			el.group.style.visibility = el.label.style.visibility = hidden ? 'hidden' : '';
		}
		if (hidden) {
			mark.placed = false;
			return;
		}
		mark.placed = true;

		// Whole pixels for the shelf, the line centred on the pixel row under the label: crisp at 1 px
		const side = mark.side || 1;
		const lx = Math.round(mark.labelX);
		const ly = Math.round(mark.labelY);
		const lineY = ly + s.stroke / 2;
		let ex = mark.x + (side * Math.abs(lineY - mark.y)) / tan; // the elbow: up the diagonal to the shelf
		if ((ex - lx) * side > 0) ex = lx;
		const endX = lx + side * mark.width;
		mark.elbowX = ex;
		mark.lineY = lineY;
		mark.shelfX = lx;
		mark.endX = endX;
		const points = `${r1(mark.x)},${r1(mark.y)} ${r1(ex)},${lineY} ${lx},${lineY} ${endX},${lineY}`;
		if (points !== mark.points) {
			mark.points = points;
			el.line.setAttribute('points', points);
		}

		// The line draws itself from the anchor to the end of the shelf
		const drawn = easeOut(range(mark.t, 0.05, 0.75));
		mark.drawn = drawn;
		let dash = 'none';
		if (drawn < 1) {
			const length = Math.hypot(ex - mark.x, lineY - mark.y) + Math.abs(endX - ex);
			dash = `${r1(length * drawn)} ${r1(length + 1)}`;
		}
		if (dash !== mark.dash) {
			mark.dash = dash;
			el.line.setAttribute('stroke-dasharray', dash);
		}

		const radius = r1(s.anchorSize * em * easeOut(range(mark.t, 0, 0.15)));
		const dotKey = `${r1(mark.x)} ${r1(mark.y)} ${radius}`;
		if (dotKey !== mark.dotKey) {
			mark.dotKey = dotKey;
			el.dot.setAttribute('cx', r1(mark.x));
			el.dot.setAttribute('cy', r1(mark.y));
			el.dot.setAttribute('r', radius);
		}

		const opacity = (mark.clear * s.opacity).toFixed(2);
		if (opacity !== mark.opacity) {
			mark.opacity = opacity;
			el.group.style.opacity = el.label.style.opacity = opacity;
		}
		const transform = `translate(${lx}px, ${ly}px)`;
		if (transform !== mark.transform) {
			mark.transform = transform;
			el.label.style.transform = transform;
		}
		if (side !== mark.shownSide) {
			mark.shownSide = side;
			el.label.dataset.side = side === -1 ? 'left' : 'right'; // not a class: Svelte owns the class list
		}
		mark.textFade = easeOut(range(mark.t, 0.6, 1));
		const text = mark.textFade.toFixed(3);
		if (text !== mark.text) {
			mark.text = text;
			el.label.style.setProperty('--text', text);
		}
	}
}

const ELBOW: Vec3 = [0, 0, 0];
const END: Vec3 = [0, 0, 0];
const PROBE: Vec3 = [0, 0, 0];

/** A point of the view (CSS px from its top-left) back into the world, at depth `ndcZ`. */
function unproject(inv: ArrayLike<number>, x: number, y: number, ndcZ: number, width: number, height: number, out: Vec3) {
	const nx = (x / width) * 2 - 1;
	const ny = 1 - (y / height) * 2;
	const w = inv[3] * nx + inv[7] * ny + inv[11] * ndcZ + inv[15];
	out[0] = (inv[0] * nx + inv[4] * ny + inv[8] * ndcZ + inv[12]) / w;
	out[1] = (inv[1] * nx + inv[5] * ny + inv[9] * ndcZ + inv[13]) / w;
	out[2] = (inv[2] * nx + inv[6] * ny + inv[10] * ndcZ + inv[14]) / w;
}

/**
 * True when the terrain rises across the segment to the eye from `lift` above the anchor: a point a little
 * behind a crest keeps its label, one well behind it doesn't.
 */
function occluded(ground: Ground, p: Vec3, lift: number, eye: Vec3): boolean {
	const py = p[1] + Math.max(0, lift);
	for (let i = 1; i < OCCLUSION_SAMPLES; i++) {
		const f = i / OCCLUSION_SAMPLES;
		const x = p[0] + (eye[0] - p[0]) * f;
		const y = py + (eye[1] - py) * f;
		const z = p[2] + (eye[2] - p[2]) * f;
		if (y < ground.heightAt(x, z)) return true;
	}
	return false;
}

/** Survey notation: easting (x), northing (north is −z), altitude. */
function surveyCoordinates(x: number, z: number, height: number): string {
	return `E ${signed(x)} · N ${signed(-z)} · ALT ${height.toFixed(1)}`;
}

function signed(v: number): string {
	return `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;
}

function range(t: number, start: number, end: number): number {
	return t <= start ? 0 : t >= end ? 1 : (t - start) / (end - start);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = range(x, edge0, edge1);
	return t * t * (3 - 2 * t);
}

function easeOut(u: number): number {
	return 1 - (1 - u) ** 3;
}

function r1(v: number): string {
	return (Math.round(v * 10) / 10).toString();
}
