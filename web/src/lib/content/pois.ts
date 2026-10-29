import type { CameraPose } from '$lib/gl/camera';

/**
 * The points of interest, one per project, all alike. Home is not one of them: it is the overview the site
 * opens on, framed by the start view (tuning.start, set in the dev panel). The POIs are framed relative to
 * it, so retuning it (its heading, say) carries every POI with it.
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

/** The start view (tuning.start): where home, the overview, looks (x, z), from how far, and the heading. */
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

/** The camera pose for home, the overview: the start view itself (read live). */
export function homeView(start: StartView): CameraPose {
	return { target: [start.x, start.z], distance: start.distance, heading: start.heading };
}

// Placeholders on the placeholder terrain (the plateau is around the origin)
export const pois: Poi[] = [
	{ id: 'test-pit', title: 'Test pit', at: [130, -230], view: { zoom: 0.4, turn: 0 } },
	{ id: 'trench-a', title: 'Trench A', at: [-70, 40], view: { zoom: 0.37, turn: 0 } },
	{ id: 'spoil-heap', title: 'Spoil heap', at: [90, -60], view: { zoom: 0.4, turn: 0 } },
	{ id: 'north-ridge', title: 'North ridge', at: [-260, -220], view: { zoom: 0.53, turn: 0 } }
];
