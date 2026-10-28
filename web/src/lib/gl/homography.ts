/**
 * CSS `matrix3d` that maps a `width × height` element (with `transform-origin: 0 0`) onto any quad on
 * screen, perspective included: used to lay HTML hit areas over 3D faces (core layers). Corners in CSS px,
 * in order: top-left, top-right, bottom-right, bottom-left.
 * Projective mapping of the unit square onto a quad (Heckbert, "Fundamentals of Texture Mapping", 1989).
 */
export function quadToMatrix3d(quad: readonly (readonly [number, number])[], width: number, height: number): string {
	const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
	const dx1 = x1 - x2;
	const dx2 = x3 - x2;
	const dx3 = x0 - x1 + x2 - x3;
	const dy1 = y1 - y2;
	const dy2 = y3 - y2;
	const dy3 = y0 - y1 + y2 - y3;
	const den = dx1 * dy2 - dx2 * dy1;
	const g = den ? (dx3 * dy2 - dx2 * dy3) / den : 0;
	const h = den ? (dx1 * dy3 - dx3 * dy1) / den : 0;
	const a = x1 - x0 + g * x1;
	const b = x3 - x0 + h * x3;
	const d = y1 - y0 + g * y1;
	const e = y3 - y0 + h * y3;
	// Unit square (u, v) → quad, after scaling the element down to the unit square; CSS is column-major
	return `matrix3d(${a / width},${d / width},0,${g / width},${b / height},${e / height},0,${h / height},0,0,1,0,${x0},${y0},0,1)`;
}
