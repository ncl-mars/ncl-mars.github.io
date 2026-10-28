/**
 * How the dev panel shows each tunable value: group, label, range, hint. Keys must match defaults.json
 * (the panel warns about any that don't). Only the dev panel imports this file.
 */

export interface Param {
	key: string;
	label: string;
	/** 'number' (default) and 'int' get a slider + number field; 'color' a colour picker (RGB 0..1). */
	kind?: 'number' | 'int' | 'color';
	min?: number;
	max?: number;
	step?: number;
	hint?: string;
}

export interface Group {
	key: string;
	label: string;
	params: Param[];
}

export const schema: Group[] = [
	{
		key: 'camera',
		label: 'Camera',
		params: [
			{ key: 'pitchNear', label: 'Pitch near (°)', min: 2, max: 89, step: 0.5, hint: 'Pitch at the closest zoom. Lower tilts up toward the horizon.' },
			{ key: 'pitchFar', label: 'Pitch far (°)', min: 2, max: 89, step: 0.5, hint: 'Pitch at the farthest zoom.' },
			{ key: 'tiltCurve', label: 'Tilt curve', min: 0.2, max: 5, step: 0.05, hint: 'Above 1: tilts up earlier while zooming in. Below 1: later.' },
			{ key: 'fov', label: 'FOV (°)', min: 10, max: 90, step: 1 },
			{ key: 'minDistance', label: 'Min distance', min: 5, max: 400, step: 1 },
			{ key: 'maxDistance', label: 'Max distance', min: 100, max: 2000, step: 10 },
			{ key: 'distance', label: 'Start distance', min: 5, max: 2000, step: 5, hint: 'Applies on reload.' }
		]
	},
	{
		key: 'controls',
		label: 'Controls',
		params: [
			{ key: 'wheelSpeed', label: 'Wheel speed', min: 0.0002, max: 0.008, step: 0.0001 },
			{ key: 'zoomSmoothing', label: 'Zoom smoothing', min: 1, max: 30, step: 0.5, hint: 'Lower glides longer.' },
			{ key: 'inertiaDecay', label: 'Inertia decay', min: 0.5, max: 20, step: 0.1, hint: 'Higher stops sooner.' },
			{ key: 'keyboardSpeed', label: 'Keyboard speed', min: 0.1, max: 4, step: 0.05 },
			{ key: 'rotateSpeed', label: 'Rotate (°/px)', min: 0.05, max: 1.5, step: 0.01, hint: 'Right-drag / Alt+drag rotation per pixel.' },
			{ key: 'keyboardRotateSpeed', label: 'Key rotate (°/s)', min: 10, max: 360, step: 5, hint: 'Q / E rotation speed.' }
		]
	},
	{
		key: 'march',
		label: 'March',
		params: [
			{ key: 'stepScale', label: 'Step scale', min: 0.1, max: 1, step: 0.01, hint: 'Fraction of the ground clearance per step. Lower: safer on steep slopes, slower.' },
			{ key: 'precision', label: 'Precision', min: 0.0001, max: 0.01, step: 0.0001, hint: 'Minimum step and hit tolerance, relative to distance.' },
			{ key: 'steps', label: 'Max steps', kind: 'int', min: 8, max: 512, step: 1 },
			{ key: 'refineSteps', label: 'Refine steps', kind: 'int', min: 0, max: 16, step: 1 }
		]
	},
	{
		key: 'shading',
		label: 'Shading',
		params: [
			{ key: 'tint', label: 'Tint', kind: 'color' },
			{ key: 'shadowLight', label: 'Light in shadow', min: 0, max: 1, step: 0.01 },
			{ key: 'aoStrength', label: 'AO strength', min: 0, max: 1, step: 0.01 },
			{ key: 'cavityStrength', label: 'Cavity strength', min: 0, max: 2, step: 0.01 },
			{ key: 'exposure', label: 'Exposure', min: 0, max: 3, step: 0.01 }
		]
	},
	{
		key: 'fog',
		label: 'Fog',
		params: [
			{ key: 'color', label: 'Colour', kind: 'color', hint: 'Fog and horizon. Also the page background.' },
			{ key: 'skyColor', label: 'Sky', kind: 'color', hint: 'Sky overhead, above the horizon fog.' },
			{ key: 'density', label: 'Density', min: 0, max: 0.006, step: 0.00005 },
			{ key: 'end', label: 'End distance', min: 200, max: 4000, step: 10, hint: 'Fully fogged from here. The raymarch stops here too.' }
		]
	},
	{
		key: 'farField',
		label: 'Far field',
		params: [
			{ key: 'amplitude', label: 'Amplitude', min: 0, max: 100, step: 0.5, hint: 'Height variation (±) of the endless ground around the heightmap.' },
			{ key: 'scale', label: 'Feature size', min: 30, max: 2000, step: 10 },
			{ key: 'blend', label: 'Blend band', min: 0.01, max: 0.5, step: 0.01, hint: 'Band along the heightmap edges where it fades into the far field (fraction of its size).' },
			{ key: 'offset', label: 'Base offset', min: -60, max: 60, step: 0.5, hint: 'Added to the far field base (the mean height of the heightmap edges).' }
		]
	},
	{
		key: 'renderer',
		label: 'Renderer',
		params: [{ key: 'maxPixelRatio', label: 'Max pixel ratio', min: 0.5, max: 3, step: 0.25 }]
	}
];
