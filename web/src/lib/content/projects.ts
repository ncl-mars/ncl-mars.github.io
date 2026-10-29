import type { Picture } from 'vite-imagetools';

/**
 * The projects, one per POI (same id): the overlay that opens when the camera arrives there, and the page
 * at /projects/<slug>/ (prerendered, for links and search engines). A POI without a project opens nothing.
 * Media files live in lib/assets/projects/<slug>/ and are named here by path: images (png, jpg, webp) go
 * through enhanced-img (resized, modern formats); videos (mp4, webm) are copied as they are, so encode them
 * for the web first (H.264 MP4 with `-movflags +faststart`, ~1080 px tall).
 */
export interface Project {
	/** Its POI's id (content/pois.ts), and the URL: /projects/<slug>/. */
	slug: string;
	title: string;
	/** A few lines, one string per paragraph. */
	presentation: string[];
	credits: { role: string; names: string }[];
	media: Media[];
}

export type Media =
	| { kind: 'image'; picture: Picture; alt: string }
	/** Plays muted and looping while visible, with controls to unmute. */
	| { kind: 'video'; src: string; poster?: string; alt: string };

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

/** An image, by its path in lib/assets/projects/ (e.g. 'trench-a/wide.png'). */
function image(path: string, alt: string): Media {
	const picture = pictures[`../assets/projects/${path}`];
	if (!picture) throw new Error(`projects: no image ${path}`);
	return { kind: 'image', picture, alt };
}

/** A video, by its path in lib/assets/projects/; `poster` is an image path, shown before it plays. */
function video(path: string, alt: string, poster?: string): Media {
	const src = videos[`../assets/projects/${path}`];
	if (!src) throw new Error(`projects: no video ${path}`);
	const still = poster ? pictures[`../assets/projects/${poster}`] : undefined;
	if (poster && !still) throw new Error(`projects: no poster ${poster}`);
	return { kind: 'video', src, poster: still?.img.src, alt };
}

// Placeholders, to test the overlay. To try a video: drop it in the project's folder and add
// video('trench-a/clip.mp4', 'What it shows', 'trench-a/clip.jpg') to its media.
export const projects: Project[] = [
	{
		slug: 'trench-a',
		title: 'Trench A',
		presentation: [
			'A stand-in project to test the overlay: a few lines of presentation, the credits, then the images and videos, one under the other.',
			'Click an image to see it full screen. Escape, the cross or a click on the scene closes the project.'
		],
		credits: [
			{ role: 'Direction', names: 'Name Surname' },
			{ role: 'Lookdev, lighting', names: 'Name Surname, Name Surname' },
			{ role: 'Client', names: 'Studio name' }
		],
		media: [
			image('trench-a/wide.png', 'Spheres at dusk: lookdev test'),
			image('trench-a/portrait.png', 'Portrait format, vertical stack'),
			image('trench-a/square.png', 'Square crop for the catalogue')
		]
	},
	{
		slug: 'spoil-heap',
		title: 'Spoil heap',
		presentation: ['A second stand-in, with two landscape images.'],
		credits: [{ role: 'Everything', names: 'Name Surname' }],
		media: [image('spoil-heap/landscape.png', 'Clay study, five materials'), image('spoil-heap/cinema.png', 'Wide shot, final grade')]
	}
];

export function projectFor(poiId: string): Project | undefined {
	return projects.find((project) => project.slug === poiId);
}
