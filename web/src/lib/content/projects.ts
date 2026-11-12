import type { Picture } from 'vite-imagetools';
import poisFile from '$lib/assets/terrain/pois.json';

/**
 * The projects, one per POI, each in its folder lib/assets/projects/<id>/ (format: doc/formats/projects.md):
 * project.md (a YAML header with the title, the credits and the media list; under it, the text: paragraphs,
 * with images and videos between them, each a line of its own, `![what it shows](file.jpg)`) and the media
 * files. Read at build time (vite.config.ts), checked here: a mistake stops the page with a message naming the
 * file. A placed project (its id in pois.json) with some text or media has a card, opened from its label and
 * the menu, and its page at /projects/<id>/ (prerendered, for links and search engines). Without, its POI only
 * has a label, as plain text.
 * Images (png, jpg, webp) go through enhanced-img (resized, modern formats); videos (mp4, webm) are copied
 * as they are, so encode them for the web first (H.264 MP4 with `-movflags +faststart`, ~1080 px tall).
 */
export interface Project {
	/** Its folder's name: its POI's id (pois.json), and the URL: /projects/<slug>/. */
	slug: string;
	title: string;
	/** The text in reading order: paragraphs, and the images and videos placed between them. */
	body: Block[];
	credits: { role: string; names: string }[];
	/** The header's media list: shown after the text and the credits. */
	media: Media[];
}

export type Media =
	| { kind: 'image'; picture: Picture; alt: string }
	/** Plays muted and looping while visible, with controls to unmute. */
	| { kind: 'video'; src: string; poster?: string; alt: string };

/** A paragraph, or a file placed in the text. */
export type Block = { kind: 'text'; text: string } | Media;

const FOLDER = '../assets/projects/';
/** The header's keys, and `presentation`: the paragraphs under it, as vite.config.ts splits them. */
const KEYS = ['title', 'credits', 'media', 'presentation'];
/** A paragraph that is only `![what it shows](file)`: that file, at that place in the text. */
const MEDIA_LINE = /^!\[([^\]]*)\]\(([^()\s]+)\)$/;

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
	(project) => placed.has(project.slug) && (project.body.length > 0 || project.media.length > 0)
);

export function projectFor(poiId: string): Project | undefined {
	return projects.find((project) => project.slug === poiId);
}

function readProject(slug: string, data: Record<string, unknown>): Project {
	const fail = (message: string) => new Error(`projects/${slug}/project.md: ${message}`);
	for (const key of Object.keys(data)) {
		if (!KEYS.includes(key)) throw fail(`unknown key "${key}" (title, credits, media)`);
	}
	if (typeof data.title !== 'string' || !data.title.trim()) throw fail('needs a title (title: …)');
	return {
		slug,
		title: data.title.trim(),
		body: (data.presentation as string[]).map((text): Block => {
			const line = MEDIA_LINE.exec(text);
			return line ? readFile(slug, line[2], line[1], fail) : { kind: 'text', text };
		}),
		credits: readCredits(data.credits, fail),
		media: readMedia(slug, data.media, fail)
	};
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

/** One `- file: what it shows` line per file of the folder, in order. */
function readMedia(slug: string, value: unknown, fail: (message: string) => Error): Media[] {
	if (value == null) return [];
	if (!Array.isArray(value)) throw fail('media: a list, one "- file.jpg: what it shows" line per file');
	return value.map((item): Media => {
		let file: string;
		let alt: unknown = '';
		if (typeof item === 'string') file = item;
		else if (isRecord(item) && Object.keys(item).length === 1) [[file, alt]] = Object.entries(item);
		else throw fail('media: write each one as "- file.jpg: what it shows"');
		return readFile(slug, file, alt == null ? '' : String(alt), fail);
	});
}

/**
 * A file of the project's folder, from the media list or a line in the text. A video's poster is the image with
 * the same name next to it (clip.mp4 → clip.jpg), if there is one.
 */
function readFile(slug: string, file: string, alt: string, fail: (message: string) => Error): Media {
	const path = `${FOLDER}${slug}/${file}`;
	if (/\.(mp4|webm)$/i.test(file)) {
		const src = videos[path];
		if (!src) throw fail(`no video ${file} in the folder`);
		const base = path.replace(/\.[^.]+$/, '');
		const poster = ['.jpg', '.jpeg', '.png', '.webp'].map((ext) => pictures[base + ext]).find(Boolean);
		return { kind: 'video', src, poster: poster?.img.src, alt };
	}
	const picture = pictures[path];
	if (!picture) throw fail(`no image ${file} in the folder (png, jpg, webp; videos mp4, webm)`);
	return { kind: 'image', picture, alt };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
