/** A label's text, for its shadow's mask (drawables/legend-shadows draws it with the same fonts). */
export interface LabelText {
	title: string;
	meta: string;
	/** The legend's text size (CSS px): the title's; the coordinates are 0.9 of it. */
	size: number;
	/** The current POI's title is bold. */
	bold: boolean;
	/** 1: aligned left (label right of its point), −1: aligned right. */
	side: number;
	/** The label's width (CSS px), the widest of its two lines. */
	width: number;
	/** Bumped when anything above changes: the mask is redrawn. */
	revision: number;
}

/**
 * The legend's lines and labels in 3D, for their shadows in the scene (drawables/legend-shadows): written by
 * the legend after each rendered frame, drawn in the next. Everything is placed on a plane facing the camera
 * through its label's point, so in 3D it stands exactly where it's seen.
 * - Segments: each label's diagonal and shelf, only the part already drawn (the line draws itself in).
 * - Labels: each shown label's text box (its title above the shelf, its coordinates under it, in the
 *   legend's em box: BOX_ABOVE and BOX_BELOW in legend.ts), with its text for the mask.
 */
export class LegendLines {
	/** Floats per segment: start xyz, end xyz (world), the size of a pixel at its depth (world units), visibility (0..1). */
	static readonly STRIDE = 8;
	/** Floats per label: top-left corner xyz, x axis xyz (to the top-right corner), y axis xyz (to the bottom-left), row (its mask: the label's index), visibility, unused. */
	static readonly LABEL_STRIDE = 12;
	readonly data: Float32Array;
	/** Segments in `data`. */
	count = 0;
	readonly labels: Float32Array;
	/** Labels in `labels`. */
	labelCount = 0;
	/** Each label's text, by row (the label's index); null until first shown. */
	readonly texts: (LabelText | null)[];
	/** The label fonts' families (the computed CSS), set by the legend. */
	fonts = { sans: 'sans-serif', mono: 'monospace' };
	/** The text box around the shelf line, in em: the title above, the coordinates under it. */
	box = { above: 1.75, below: 1.6 };

	constructor(
		readonly capacity: number,
		/** Labels (two segments each). */
		readonly labelCapacity = Math.ceil(capacity / 2)
	) {
		this.data = new Float32Array(capacity * LegendLines.STRIDE);
		this.labels = new Float32Array(labelCapacity * LegendLines.LABEL_STRIDE);
		this.texts = new Array(labelCapacity).fill(null);
	}
}
