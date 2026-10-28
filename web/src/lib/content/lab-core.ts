// Placeholder project for the core viewer prototype (/lab/core). Images and relief maps come from
// `npm run gen:lab-core` (scripts/gen-lab-core.mjs) until real projects and Houdini depth maps exist.
import type { Picture } from 'vite-imagetools';
import { parseReliefMeta, type ReliefMeta } from '$lib/core/relief';

const DIR = '../assets/lab/core';
const pictures = import.meta.glob<Picture>('../assets/lab/core/*.png', {
	eager: true,
	query: '?enhanced',
	import: 'default'
});
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
		'A stand-in project to prototype the core viewer: five render-like images, each carved as a relief ' +
		'stratum from its depth map. Scroll to dig through the layers; click one to see it in colour.',
	images: captions.map((caption, i) => {
		const name = `image-${i + 1}`;
		return {
			picture: pictures[`${DIR}/${name}.png`],
			reliefUrl: reliefUrls[`${DIR}/${name}.relief.bin`],
			relief: parseReliefMeta(reliefMetas[`${DIR}/${name}.relief.json`], `${name}.relief.json`),
			caption
		};
	})
};
