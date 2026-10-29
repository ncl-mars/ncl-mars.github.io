import type { Picture } from 'vite-imagetools';
import poisFile from '$lib/assets/terrain/pois.json';
import type { PoiView } from './pois';

/**
 * The projects, one per POI, each in its folder lib/assets/projects/<id>/ (format: doc/formats/projects.md):
 * project.md (a YAML header with the title, the camera framing, the credits and the media list; the
 * paragraphs under it) and the media files. Read at build time (vite.config.ts), checked here: a mistake
 * stops the page with a message naming the file. A placed project (its id in pois.json) with some text or
 * media has a card: the Data button on its label, and its page at /projects/<id>/ (prerendered, for links
 * and search engines). Without, its POI only has a label.
 * Images (png, jpg, webp) go through enhanced-img (resized, modern formats); videos (mp4, webm) are copied
 * as they are, so encode them for the web first (H.264 MP4 with `-movflags +faststart`, ~1080 px tall).
 */
export interface Project {
	/** Its folder's name: its POI's id (pois.json), and the URL: /projects/<slug>/. */
	slug: string;
	title: string;
	/** How the camera frames its POI, relative to the start view (content/pois.ts). Default there. */
	view?: PoiView;
	/** A few lines, one string per paragraph. */
	presentation: string[];
	credits: { role: string; names: string }[];
	media: Media[];
}

export type Media =
	| { kind: 'image'; picture: Picture; alt: string }
	/** Plays muted and looping while visible, with controls to unmute. */
	| { kind: 'video'; src: string; poster?: string; alt: string };

const FOLDER = '../assets/projects/';
const KEYS = ['title', 'view', 'credits', 'media', 'presentation'];

const files = import.meta.glob<Record<string, unknown>>('../assets/projects/*/project.md', {
	eager: true,
	import: 'default'
});
const pictures = import.meta.glob<Picture>('../assets/projects/*/*.{png,jpg,jpeg,webp}', {
	eager: true,
	query: '?enhanced',
	import: 'default'
});
const videos = import.meta.glob<string>('../assets/projects/*/*.{mp4,webm}', {
	eager: true,
	query: '?url',
	import: 'default'
});

/** Every project folder (the POIs give the order). */
export const allProjects: Project[] = Object.entries(files).map(([path, data]) =>
	readProject(path.slice(FOLDER.length, -'/project.md'.length), data)
);

// A folder whose id isn't in pois.json isn't on the map yet: no card, no page
const placed = new Set((poisFile as { pois?: { id?: unknown }[] }).pois?.map((poi) => poi.id));
for (const project of allProjects) {
	if (!placed.has(project.slug)) console.warn(`projects/${project.slug}/: no POI with this id in pois.json, not shown`);
}

/** The placed projects with a card (some text or media). */
export const projects: Project[] = allProjects.filter(
	(project) => placed.has(project.slug) && (project.presentation.length > 0 || project.media.length > 0)
);

export function projectFor(poiId: string): Project | undefined {
	return projects.find((project) => project.slug === poiId);
}

function readProject(slug: string, data: Record<string, unknown>): Project {
	const fail = (message: string) => new Error(`projects/${slug}/project.md: ${message}`);
	for (const key of Object.keys(data)) {
		if (!KEYS.includes(key)) throw fail(`unknown key "${key}" (title, view, credits, media)`);
	}
	if (typeof data.title !== 'string' || !data.title.trim()) throw fail('needs a title (title: …)');
	return {
		slug,
		title: data.title.trim(),
		view: readView(data.view, fail),
		presentation: data.presentation as string[],
		credits: readCredits(data.credits, fail),
		media: readMedia(slug, data.media, fail)
	};
}

/** `view: { zoom: 0.4, turn: 0 }`, as "Copy pose" writes it (with `target: [x, z]` when it looks elsewhere). */
function readView(value: unknown, fail: (message: string) => Error): PoiView | undefined {
	if (value == null) return undefined;
	if (!isRecord(value)) throw fail('view: write it as view: { zoom: 0.4, turn: 0 } ("Copy pose" in the dev panel)');
	const { zoom = 0.4, turn = 0, target } = value;
	if (!isNumber(zoom) || zoom <= 0) throw fail('view: zoom must be a number above 0');
	if (!isNumber(turn)) throw fail('view: turn must be a number (degrees)');
	const view: PoiView = { zoom, turn };
	if (target !== undefined) {
		if (!Array.isArray(target) || target.length !== 2 || !target.every(isNumber)) throw fail('view: target must be [x, z]');
		view.target = [target[0], target[1]];
	}
	return view;
}

/** One `Role: names` line per role, in order; the names as text, or a list. */
function readCredits(value: unknown, fail: (message: string) => Error): Project['credits'] {
	if (value == null) return [];
	if (!isRecord(value)) throw fail('credits: one "Role: names" line per role, indented under credits:');
	return Object.entries(value).map(([role, names]) => {
		const list = Array.isArray(names) ? names : [names];
		if (!list.every((name) => typeof name === 'string' || typeof name === 'number')) {
			throw fail(`credits: the names for "${role}" must be text`);
		}
		return { role, names: list.join(', ') };
	});
}

/**
 * One `- file: what it shows` line per file of the folder, in order. A video's poster is the image with the
 * same name next to it (clip.mp4 → clip.jpg), if there is one.
 */
function readMedia(slug: string, value: unknown, fail: (message: string) => Error): Media[] {
	if (value == null) return [];
	if (!Array.isArray(value)) throw fail('media: a list, one "- file.jpg: what it shows" line per file');
	return value.map((item): Media => {
		let file: string;
		let alt: unknown = '';
		if (typeof item === 'string') file = item;
		else if (isRecord(item) && Object.keys(item).length === 1) [[file, alt]] = Object.entries(item);
		else throw fail('media: write each one as "- file.jpg: what it shows"');
		const text = alt == null ? '' : String(alt);
		const path = `${FOLDER}${slug}/${file}`;
		if (/\.(mp4|webm)$/i.test(file)) {
			const src = videos[path];
			if (!src) throw fail(`media: no video ${file} in the folder`);
			const base = path.replace(/\.[^.]+$/, '');
			const poster = ['.jpg', '.jpeg', '.png', '.webp'].map((ext) => pictures[base + ext]).find(Boolean);
			return { kind: 'video', src, poster: poster?.img.src, alt: text };
		}
		const picture = pictures[path];
		if (!picture) throw fail(`media: no image ${file} in the folder (png, jpg, webp; videos mp4, webm)`);
		return { kind: 'image', picture, alt: text };
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}
