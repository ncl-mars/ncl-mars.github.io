import type { CameraPose } from '$lib/gl/camera';

/**
 * The points of interest, in visiting order: scrolling, the arrow keys and swipes step through this list;
 * clicking a label flies to any of them. The first one is where the site opens.
 * Frame a view with the dev panel's free camera, then "Copy pose" and paste it as `view`.
 */
export interface Poi {
	/** Stable id (later the project's slug). */
	id: string;
	title: string;
	/** The ground point its legend line comes from (world x, z). */
	at: [number, number];
	/** The camera at this POI. */
	view: CameraPose;
}

// Placeholders on the placeholder terrain (the plateau is around the origin)
export const pois: Poi[] = [
	{ id: 'site', title: 'Dig site', at: [0, 0], view: { target: [0, 0], distance: 300, heading: 0 } },
	{ id: 'trench-a', title: 'Trench A', at: [-70, 40], view: { target: [-70, 40], distance: 110, heading: 330 } },
	{ id: 'spoil-heap', title: 'Spoil heap', at: [90, -60], view: { target: [90, -60], distance: 120, heading: 60 } },
	{ id: 'north-ridge', title: 'North ridge', at: [-260, -220], view: { target: [-260, -220], distance: 160, heading: 300 } }
];
