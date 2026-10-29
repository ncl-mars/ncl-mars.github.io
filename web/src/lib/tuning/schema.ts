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
			{ key: 'minDistance', label: 'Min distance', min: 5, max: 400, step: 1, hint: 'Closest zoom, everywhere (POI distances included).' },
			{ key: 'maxDistance', label: 'Max distance', min: 100, max: 2000, step: 10 }
		]
	},
	{
		key: 'start',
		label: 'Start view',
		params: [
			{ key: 'x', label: 'Pivot x', min: -500, max: 500, step: 1, hint: 'Where home, the overview, looks (world x). The camera turns and zooms around it there.' },
			{ key: 'z', label: 'Pivot z', min: -500, max: 500, step: 1, hint: 'World z (north is −z).' },
			{ key: 'distance', label: 'Distance', min: 20, max: 2000, step: 1, hint: 'POI distances are multiples of it. Kept within the camera’s min / max distance.' },
			{ key: 'heading', label: 'Heading (°)', min: 0, max: 360, step: 1, hint: 'Compass direction the camera looks (0 north, 90 east). POI headings turn with it.' }
		]
	},
	{
		key: 'controls',
		label: 'Controls',
		params: [
			{ key: 'wheelSpeed', label: 'Zoom speed (wheel)', min: 0.0002, max: 0.008, step: 0.0001 },
			{ key: 'zoomSmoothing', label: 'Zoom smoothing', min: 1, max: 30, step: 0.5, hint: 'Wheel and key zoom, key turns. Lower glides longer.' },
			{ key: 'inertiaDecay', label: 'Turn inertia decay', min: 0.5, max: 20, step: 0.1, hint: 'After a drag. Higher stops sooner.' },
			{ key: 'rotateSpeed', label: 'Turn (°/px)', min: 0.05, max: 1.5, step: 0.01, hint: 'Per pixel dragged: any drag (right-drag / Alt+drag in the free camera).' },
			{ key: 'keyboardRotateSpeed', label: 'Key turn (°/s)', min: 10, max: 360, step: 5, hint: '← / → and Q / E.' },
			{ key: 'keyboardSpeed', label: 'Pan keys (free camera)', min: 0.1, max: 4, step: 0.05, hint: 'Dev only: WASD / arrows in the free camera.' }
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
			{ key: 'renderScale', label: 'Render scale', min: 0.25, max: 1, step: 0.05, hint: 'Resolution of the terrain cache (the raymarch). Lower is cheaper; the mist stays full resolution.' },
			{ key: 'motionScale', label: 'Motion scale', min: 0.1, max: 1, step: 0.05, hint: 'Resolution of the rough march while the camera moves (see Rough in motion), as a fraction of the render scale; a sharp march follows once it stops.' },
			{ key: 'motionMode', label: 'Rough in motion', kind: 'int', min: 0, max: 2, step: 1, hint: '0: never, the march stays sharp while moving. 1: automatic, on for good the first time moving frames run under ~52 fps on this device, before the resolution drops; remembered on the device (switching away and back forgets it and restarts the detection). 2: always. The stats show "motion sharp / rough".' }
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
		key: 'shafts',
		label: 'Light shafts',
		params: [
			{ key: 'samples', label: 'Samples', kind: 'int', min: 0, max: 64, step: 1, hint: 'Per view ray through the mist, in the march (cached: a still view pays nothing). More: smoother shafts, slower moving frames. 0: off.' },
			{ key: 'softness', label: 'Edge softness', min: 0, max: 10, step: 0.1, hint: 'Shadow edges in the air, world units.' },
			{ key: 'darkness', label: 'Shadow darkness', min: 0, max: 1, step: 0.01, hint: 'How much the air (mist and haze) darkens in the shadow of the ridges.' },
			{ key: 'glow', label: 'Glow', min: 0, max: 2, step: 0.01, hint: 'Sunlit air brightening toward the sun, on top of the fog’s sun glow (which air in shadow loses).' },
			{ key: 'power', label: 'Glow tightness', min: 1, max: 32, step: 0.5, hint: 'Lower: the glow spreads wider around the sun.' },
			{ key: 'view', label: 'Show shadow volumes', kind: 'int', min: 0, max: 1, step: 1, hint: 'Dev: 1 replaces the scene with how lit each ray is, in grey (white: all lit, darker: through the shadow of the ground).' }
		]
	},
	{
		key: 'legendShadows',
		label: 'Legend shadows',
		params: [
			{ key: 'strength', label: 'Strength', min: 0, max: 20, step: 0.1, hint: 'How dark the legend lines’ shadows are in the god rays. Thin sheets: they show when looked along, mostly toward the sun. 0: off.' },
			{ key: 'thickness', label: 'Thickness (px)', min: 0.5, max: 20, step: 0.5, hint: 'Of the shadow sheet, in pixels of the line at its point’s depth. The line itself is 1 px: thicker reads stronger.' },
			{ key: 'maxLength', label: 'Longest path', min: 5, max: 300, step: 5, hint: 'World units of a sheet a view ray counts at most: caps the streak when you look right along it.' },
			{ key: 'ground', label: 'Ground shadow', min: 0, max: 1, step: 0.01, hint: 'How dark the lines’ shadows on the ground are (a thin line, the width of the sheet). Like the baked shadows, nothing where a ridge already shades the ground. 0: off.' },
			{ key: 'text', label: 'Text on the ground', min: 0, max: 1, step: 0.01, hint: 'How dark the labels’ letters are on the ground (title and coordinates, stretched by the low sun). 0: off.' },
			{ key: 'textSoftness', label: 'Text softness', min: 0, max: 0.05, step: 0.001, hint: 'The letters’ penumbra: how much their shadow blurs per world unit from the label. 0: sharp all the way.' },
			{ key: 'textAir', label: 'Text in the god rays', min: 0, max: 10, step: 0.1, hint: 'How dark the letters’ shadow is in the air: letter-shaped shafts looking toward the sun, a soft veil across them. The costly part. 0: off (not computed).' },
			{ key: 'textSamples', label: 'Text samples', kind: 'int', min: 2, max: 16, step: 1, hint: 'Per view ray through a label’s shadow. More: finer letters in the air, slower.' }
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
		key: 'dust',
		label: 'Dust',
		params: [
			{ key: 'count', label: 'Count', kind: 'int', min: 0, max: 200000, step: 500, hint: 'Specks in the box. The main cost: lower it on phones. 0: no dust.' },
			{ key: 'size', label: 'Size', min: 0.02, max: 2, step: 0.01, hint: 'World units. Far specks stay 1.5 px and fade instead of shrinking.' },
			{ key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01 },
			{ key: 'color', label: 'Colour', kind: 'color' },
			{ key: 'backlight', label: 'Backlight', min: 0, max: 6, step: 0.05, hint: 'Glow in the sun colour when the camera looks toward the sun through them.' },
			{ key: 'range', label: 'Range', min: 40, max: 1000, step: 10, hint: 'Size of the box they live in, ahead of the camera. Larger: the same count spread thinner.' },
			{ key: 'height', label: 'Height', min: 1, max: 120, step: 0.5, hint: 'How high above the ground they go; most stay low.' },
			{ key: 'follow', label: 'Wind follow', min: 0, max: 2, step: 0.01, hint: 'Fraction of the wind speed they drift at (Wind group).' },
			{ key: 'turbulence', label: 'Turbulence', min: 0, max: 20, step: 0.1, hint: 'How far each speck wanders around its place (world units).' },
			{ key: 'turbulenceScale', label: 'Eddy size', min: 2, max: 200, step: 1, hint: 'Specks closer than this wander together.' },
			{ key: 'turbulenceSpeed', label: 'Eddy speed', min: 0, max: 1, step: 0.01, hint: 'How fast the eddies change.' },
			{ key: 'hops', label: 'Hopping share', min: 0, max: 1, step: 0.01, hint: 'Share of specks skipping along the ground instead of floating.' },
			{ key: 'hopHeight', label: 'Hop height', min: 0, max: 10, step: 0.1 },
			{ key: 'maxSize', label: 'Largest (px)', min: 2, max: 64, step: 1, hint: 'Cap for specks close to the camera.' },
			{ key: 'nearFade', label: 'Near fade', min: 0, max: 40, step: 0.5, hint: 'Specks closer to the camera than this fade out (world units).' }
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
			{ key: 'smallScale', label: 'Phone scale', min: 0.3, max: 1, step: 0.01, hint: 'Under 700 px wide (phones), the scale is multiplied by this.' },
			{ key: 'stroke', label: 'Line width (px)', min: 0.5, max: 3, step: 0.25, hint: 'Not scaled: stays a hairline.' },
			{ key: 'anchorSize', label: 'Anchor ring (em)', min: 0, max: 0.8, step: 0.01, hint: 'Radius of the ring on the point. 0: none.' },
			{ key: 'rise', label: 'Rise (em)', min: 0, max: 12, step: 0.1, hint: 'How far above its point a label sits.' },
			{ key: 'angle', label: 'Diagonal (°)', min: 15, max: 90, step: 1, hint: 'Angle of the line leaving the point. 90: vertical.' },
			{ key: 'column', label: 'Column inset', min: 0.05, max: 0.45, step: 0.01, hint: 'Layout 1: where the columns start, as a fraction of the width from each edge.' },
			{ key: 'spacing', label: 'Spacing (em)', min: 1.5, max: 10, step: 0.1, hint: 'Layout 1: minimum distance between two labels of a column.' },
			{ key: 'follow', label: 'Follow', min: 0.5, max: 30, step: 0.5, hint: 'How fast a label moves to its new height: out of another label’s way (layout 0), after its point (layout 1). Lower is calmer.' },
			{ key: 'flightFollow', label: 'Follow in flight', min: 0.5, max: 30, step: 0.5, hint: 'Follow, while the camera flies to a POI. Lower: labels drift slowly during the flight and settle after it lands.' },
			{ key: 'lift', label: 'Anchor lift', min: 0, max: 20, step: 0.1, hint: 'Height of the point above the ground, world units.' },
			{ key: 'occlusionLift', label: 'Occlusion lift', min: 0, max: 50, step: 0.5, hint: 'The ridge test looks from this high above the point (world units): a point a little behind a crest keeps its label. 0: hidden as soon as the point is.' },
			{ key: 'fogCutoff', label: 'Fog cutoff', min: 0.1, max: 1, step: 0.01, hint: 'Mist cover (0 clear … 1 opaque) at which a label has faded down to the mist floor. It starts fading at half of it.' },
			{ key: 'mistFloor', label: 'Mist floor', min: 0, max: 1, step: 0.01, hint: 'Lowest opacity a label fades to in the mist (× Opacity), so it stays readable. 0: labels can vanish in it.' },
			{ key: 'drawTime', label: 'Draw time (s)', min: 0, max: 4, step: 0.05, hint: 'Line drawing, then text fading in. Leaving is 1.5× faster.' },
			{ key: 'stagger', label: 'Stagger (s)', min: 0, max: 1, step: 0.01, hint: 'Delay between labels on the first reveal.' }
		]
	},
	{
		key: 'overlay',
		label: 'Project overlay',
		params: [
			{ key: 'blur', label: 'Scene blur (px)', min: 0, max: 40, step: 0.5, hint: 'Blur of everything behind the card (scene, labels). The scene stays animated.' },
			{ key: 'saturation', label: 'Scene saturation', min: 0, max: 1.5, step: 0.01, hint: '0: gray. 1: unchanged.' },
			{ key: 'brightness', label: 'Scene brightness', min: 0.2, max: 1.5, step: 0.01, hint: '1: unchanged.' },
			{ key: 'tint', label: 'Scene tint', kind: 'color', hint: 'A wash over the scene, at Tint opacity.' },
			{ key: 'tintOpacity', label: 'Tint opacity', min: 0, max: 1, step: 0.01 },
			{ key: 'panelColor', label: 'Card colour', kind: 'color' },
			{ key: 'panelOpacity', label: 'Card opacity', min: 0, max: 1, step: 0.01, hint: 'Below 1 the scene shows through.' },
			{ key: 'align', label: 'Position', kind: 'int', min: 0, max: 2, step: 1, hint: '0: left. 1: centred. 2: right. In dev the panel may cover it: P hides the panel.' },
			{ key: 'width', label: 'Card width (rem)', min: 20, max: 70, step: 0.5, hint: 'On wide screens. Phones get the full width.' },
			{ key: 'fadeTime', label: 'Fade time (s)', min: 0, max: 2, step: 0.05, hint: 'Opening; closing is 1.5× faster.' }
		]
	},
	{
		key: 'renderer',
		label: 'Renderer',
		params: [
			{ key: 'maxPixelRatio', label: 'Max pixel ratio', min: 0.5, max: 3, step: 0.25 },
			{ key: 'adaptive', label: 'Adaptive resolution', kind: 'int', min: 0, max: 1, step: 1, hint: '1: the pixel ratio drops a step when frames run long, and climbs back once they keep up (shown as q in the stats).' },
			{ key: 'minScale', label: 'Lowest scale', min: 0.25, max: 1, step: 0.05, hint: 'Floor of the adaptive resolution, as a fraction of the pixel ratio.' }
		]
	}
];
