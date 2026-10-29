/**
 * The legend's lines in 3D, for their shadows in the scene (drawables/legend-shadows): written by the legend
 * after each rendered frame, drawn in the next. Each label gives two segments (the diagonal, then the shelf),
 * placed on a plane facing the camera through its anchor, so in 3D they stand exactly where they're seen;
 * only the part already drawn (the line draws itself in).
 */
export class LegendLines {
	/** Floats per segment: start xyz, end xyz (world), the size of a pixel at its depth (world units), visibility (0..1). */
	static readonly STRIDE = 8;
	readonly data: Float32Array;
	/** Segments in `data`. */
	count = 0;

	constructor(readonly capacity: number) {
		this.data = new Float32Array(capacity * LegendLines.STRIDE);
	}
}
