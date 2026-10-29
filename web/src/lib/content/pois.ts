import type { CameraPose } from '$lib/gl/camera';
import { tuning } from '$lib/tuning';

/**
 * The points of interest. The first one is home: the overview the site opens on, framed by the start view
 * (tuning.start, set in the dev panel), its point being the start view's pivot. The others are framed
 * relative to the start view, so retuning it (its heading, say) carries every POI with it.
 * Frame a view with the dev panel's free camera, then "Copy pose" and paste it as `view`.
 */
export interface Poi {
	/** Stable id, and the slug of its project if it has one (content/projects.ts). */
	id: string;
	title: string;
	/** The ground point its legend line comes from (world x, z). */
	at: [number, number];
	view: PoiView;
}

/** How the camera frames a POI, relative to the start view. */
export interface PoiView {
	/** Ground point looked at (x, z). Default: the POI's point. */
	target?: [number, number];
	/** Distance, as a multiple of the start distance. */
	zoom: number;
	/** Heading, in degrees from the start heading. */
	turn: number;
}

/** The start view (tuning.start): where home looks (x, z), from how far, and the compass heading. */
export interface StartView {
	x: number;
	z: number;
	distance: number;
	heading: number;
}

/** The camera pose for a POI, from the start view (read live). */
export function poiView(poi: Poi, start: StartView): CameraPose {
	const [x, z] = poi.view.target ?? poi.at;
	return { target: [x, z], distance: start.distance * poi.view.zoom, heading: start.heading + poi.view.turn };
}

// Placeholders on the placeholder terrain (the plateau is around the origin)
export const pois: Poi[] = [
	{
		id: 'site',
		title: 'Dig site',
		get at(): [number, number] {
			return [tuning.start.x, tuning.start.z];
		},
		view: { zoom: 1, turn: 0 }
	},
	{ id: 'trench-a', title: 'Trench A', at: [-70, 40], view: { zoom: 0.37, turn: 0 } },
	{ id: 'spoil-heap', title: 'Spoil heap', at: [90, -60], view: { zoom: 0.4, turn: 0 } },
	{ id: 'north-ridge', title: 'North ridge', at: [-260, -220], view: { zoom: 0.53, turn: 0 } }
];
