// Placeholder project for the core viewer prototype (/lab/core): image-1 … image-5, each a colour image
// (png, jpg or webp) + its relief map, from `npm run gen:lab-core` or your own exports
// (hou/snippets/export_relief.py). Replace any image-N.* + image-N.relief.* pair to test your own.
import type { Picture } from 'vite-imagetools';
import { parseReliefMeta, type ReliefMeta } from '$lib/core/relief';

const DIR = '../assets/lab/core';
const pictures = import.meta.glob<Picture>('../assets/lab/core/*.{png,jpg,jpeg,webp}', {
	eager: true,
	query: '?enhanced',
	import: 'default'
});

/** The colour image whose base name is `name`, whatever its extension. */
function colourImage(name: string): Picture {
	const key = Object.keys(pictures).find((path) => path.slice(path.lastIndexOf('/') + 1).split('.')[0] === name);
	if (!key) throw new Error(`lab core: no colour image for ${name}`);
	return pictures[key];
}
const reliefUrls = import.meta.glob<string>('../assets/lab/core/*.relief.bin', {
	eager: true,
	query: '?url',
	import: 'default'
});
const reliefMetas = import.meta.glob('../assets/lab/core/*.relief.json', { eager: true, import: 'default' });

export interface ProjectImage {
	/** Colour image, for the lightbox (`<enhanced:img>`). */
	picture: Picture;
	reliefUrl: string;
	relief: ReliefMeta;
	caption: string;
}

export interface Project {
	cell: string;
	title: string;
	text: string;
	images: ProjectImage[];
}

const captions = [
	'Spheres at dusk: lookdev test',
	'Clay study, five materials',
	'Square crop for the catalogue',
	'Portrait format, vertical stack',
	'Wide shot, final grade'
];

export const labProject: Project = {
	cell: 'C4',
	title: 'Placeholder project',
	text:
		'A stand-in project to prototype the core viewer: five render-like images, buried in the rock one ' +
		'stratum apart. Scroll to dig; when the cut reaches an image, its relief appears. Click it to see it in colour.',
	images: captions.map((caption, i) => {
		const name = `image-${i + 1}`;
		return {
			picture: colourImage(name),
			reliefUrl: reliefUrls[`${DIR}/${name}.relief.bin`],
			relief: parseReliefMeta(reliefMetas[`${DIR}/${name}.relief.json`], `${name}.relief.json`),
			caption
		};
	})
};
