import type { CameraPose } from '$lib/gl/camera';
import poisFile from '$lib/assets/terrain/pois.json';
import heightmapFile from '$lib/assets/terrain/heightmap.json';
import { allProjects } from './projects';

/**
 * The points of interest, one per project, all alike. Where they are comes from pois.json, exported from
 * Houdini (hou/snippets/python/export_pois.py, format: doc/formats/pois.md): an id and x, z per point, in
 * menu order. The rest comes from the project's folder (content/projects.ts): its title, and its framing.
 * Home is not one of them: it is the overview the site opens on, framed by the start view (tuning.start,
 * set in the dev panel). The POIs are framed relative to it, so retuning it (its heading, say) carries
 * every POI with it. Frame a view with the dev panel's free camera, then "Copy pose" and paste the line
 * into the project's project.md.
 */
export interface Poi {
	/** Stable id: its project's folder (lib/assets/projects/<id>/) and URL (/projects/<id>/). */
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

/** Framing of a POI whose project.md has no `view`. */
const DEFAULT_VIEW: PoiView = { zoom: 0.4, turn: 0 };
/** Ids are URL parts and folder names: lowercase letters, digits, hyphens. */
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const pois: Poi[] = readPois(poisFile);

/** pois.json, checked: a mistake stops the page with a message saying what's wrong. */
function readPois(json: unknown): Poi[] {
	const fail = (message: string) => new Error(`pois.json: ${message}`);
	const file = json as { version?: unknown; pois?: unknown };
	if (file?.version !== 1) throw fail(`unsupported version ${file?.version}`);
	if (!Array.isArray(file.pois) || file.pois.length === 0) throw fail('needs a "pois" list with at least one POI');

	const { min, max } = heightmapFile.bounds;
	const projects = new Map(allProjects.map((project) => [project.slug, project]));
	const seen = new Set<string>();
	return file.pois.map((entry: { id?: unknown; x?: unknown; z?: unknown }, i): Poi => {
		const { id, x, z } = entry ?? {};
		if (typeof id !== 'string' || !ID.test(id)) throw fail(`POI ${i}: id "${id}" must be lowercase letters, digits and hyphens`);
		if (seen.has(id)) throw fail(`"${id}" is there twice`);
		seen.add(id);
		if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) {
			throw fail(`"${id}": x and z must be numbers`);
		}
		if (x < min[0] || x > max[0] || z < min[2] || z > max[2]) {
			throw fail(`"${id}" (x ${x}, z ${z}) is outside the heightmap (x ${min[0]}…${max[0]}, z ${min[2]}…${max[2]})`);
		}
		const project = projects.get(id);
		if (!project) console.warn(`pois.json: "${id}" has no folder lib/assets/projects/${id}/ with a project.md yet`);
		return { id, title: project?.title ?? titleFrom(id), at: [x, z], view: project?.view ?? { ...DEFAULT_VIEW } };
	});
}

/** A label for a POI without a project yet: north-ridge → North ridge. */
function titleFrom(id: string): string {
	const words = id.replace(/-/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}
