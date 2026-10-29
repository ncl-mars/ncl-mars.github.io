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
			{ key: 'fov', label: 'FOV (°)', min: 10, max: 120, step: 1 },
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
			{ key: 'rotateSpeed', label: 'Rotate (°/px)', min: 0.05, max: 1.5, step: 0.01, hint: 'Turn per pixel dragged: any drag at a POI, right-drag / Alt+drag in the free camera.' },
			{ key: 'keyboardRotateSpeed', label: 'Key rotate (°/s)', min: 10, max: 360, step: 5, hint: 'Q / E rotation speed.' }
		]
	},
	{
		key: 'flight',
		label: 'Flight',
		params: [
			{ key: 'curvature', label: 'Back-off', min: 0.3, max: 4, step: 0.05, hint: 'How much a flight zooms out on the way, relative to the distance travelled. √2 is the textbook value; a wide FOV needs more (hops look short in a wide view).' },
			{ key: 'pace', label: 'Pace (s)', min: 0.2, max: 6, step: 0.05, hint: 'Seconds per view width travelled. Higher is slower.' },
			{ key: 'minTime', label: 'Min time (s)', min: 0.2, max: 4, step: 0.05, hint: 'Shortest flight (short hops, turns).' },
			{ key: 'maxTime', label: 'Max time (s)', min: 1, max: 12, step: 0.1, hint: 'Longest flight (far POIs).' },
			{ key: 'ease', label: 'Ease', min: 1, max: 5, step: 0.05, hint: 'Ease in and out. The middle of a flight runs this many times its average speed: 1 is constant speed (abrupt start), 3 cubic.' }
		]
	},
	{
		key: 'march',
		label: 'March',
		params: [
			{ key: 'stepScale', label: 'Step scale', min: 0.1, max: 1, step: 0.01, hint: 'Fraction of the ground clearance per step. Lower: safer on steep slopes, slower.' },
			{ key: 'precision', label: 'Precision', min: 0.0001, max: 0.01, step: 0.0001, hint: 'Minimum step and hit tolerance, relative to distance.' },
			{ key: 'steps', label: 'Max steps', kind: 'int', min: 8, max: 512, step: 1 },
			{ key: 'refineSteps', label: 'Refine steps', kind: 'int', min: 0, max: 16, step: 1 },
			{ key: 'renderScale', label: 'Render scale', min: 0.25, max: 1, step: 0.05, hint: 'Resolution of the terrain cache (the raymarch). Lower is cheaper; the mist stays full resolution.' }
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
			{ key: 'end', label: 'End distance', min: 200, max: 4000, step: 10, hint: 'Fully fogged from here. The raymarch stops here too.' },
			{ key: 'sunColor', label: 'Sun glow colour', kind: 'color' },
			{ key: 'sunGlow', label: 'Sun glow', min: 0, max: 2, step: 0.01, hint: 'How much the fog brightens toward the sun.' },
			{ key: 'sunPower', label: 'Sun glow tightness', min: 1, max: 64, step: 0.5 }
		]
	},
	{
		key: 'mist',
		label: 'Mist',
		params: [
			{ key: 'density', label: 'Density', min: 0, max: 0.05, step: 0.0005, hint: 'Mist thickness at its base height.' },
			{ key: 'height', label: 'Base height', min: -20, max: 100, step: 0.5, hint: 'Above the lowest ground. Below it the mist is densest.' },
			{ key: 'falloff', label: 'Falloff', min: 1, max: 80, step: 0.5, hint: 'Height over which the mist thins out (×1/e).' },
			{ key: 'banks', label: 'Banks', min: 0, max: 1, step: 0.01, hint: 'How patchy the mist is (0: uniform).' },
			{ key: 'bankScale', label: 'Bank size', min: 20, max: 1500, step: 10 }
		]
	},
	{
		key: 'wind',
		label: 'Wind',
		params: [
			{ key: 'direction', label: 'Direction (°)', min: 0, max: 360, step: 1, hint: 'Compass direction the wind blows toward (0 north, 90 east).' },
			{ key: 'speed', label: 'Speed', min: 0, max: 60, step: 0.5, hint: 'World units per second.' }
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
		key: 'legend',
		label: 'Legend lines',
		params: [
			{ key: 'layout', label: 'Layout', kind: 'int', min: 0, max: 1, step: 1, hint: '0: each label beside its point. 1: labels in a column on each side, only their height follows.' },
			{ key: 'ink', label: 'Ink', kind: 'color', hint: 'Lines and text.' },
			{ key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01 },
			{ key: 'scale', label: 'Scale (rem)', min: 0.5, max: 2.5, step: 0.01, hint: 'Text size. Rise, spacing and the anchor ring are multiples of it (em), so this sizes the whole legend.' },
			{ key: 'stroke', label: 'Line width (px)', min: 0.5, max: 3, step: 0.25, hint: 'Not scaled: stays a hairline.' },
			{ key: 'anchorSize', label: 'Anchor ring (em)', min: 0, max: 0.8, step: 0.01, hint: 'Radius of the ring on the point. 0: none.' },
			{ key: 'rise', label: 'Rise (em)', min: 0, max: 12, step: 0.1, hint: 'How far above its point a label sits.' },
			{ key: 'angle', label: 'Diagonal (°)', min: 15, max: 90, step: 1, hint: 'Angle of the line leaving the point. 90: vertical.' },
			{ key: 'column', label: 'Column inset', min: 0.05, max: 0.45, step: 0.01, hint: 'Layout 1: where the columns start, as a fraction of the width from each edge.' },
			{ key: 'spacing', label: 'Spacing (em)', min: 1.5, max: 10, step: 0.1, hint: 'Layout 1: minimum distance between two labels of a column.' },
			{ key: 'follow', label: 'Follow', min: 0.5, max: 30, step: 0.5, hint: 'Layout 1: how fast a label follows its point up and down. Lower is calmer.' },
			{ key: 'lift', label: 'Anchor lift', min: 0, max: 20, step: 0.1, hint: 'Height of the point above the ground, world units.' },
			{ key: 'fogCutoff', label: 'Fog cutoff', min: 0.1, max: 1, step: 0.01, hint: 'Mist cover (0 clear … 1 opaque) at which a label has faded out. It starts fading at half of it.' },
			{ key: 'drawTime', label: 'Draw time (s)', min: 0, max: 4, step: 0.05, hint: 'Line drawing, then text fading in. Leaving is 1.5× faster.' },
			{ key: 'stagger', label: 'Stagger (s)', min: 0, max: 1, step: 0.01, hint: 'Delay between labels on the first reveal.' }
		]
	},
	{
		key: 'renderer',
		label: 'Renderer',
		params: [{ key: 'maxPixelRatio', label: 'Max pixel ratio', min: 0.5, max: 3, step: 0.25 }]
	}
];
