import { error } from '@sveltejs/kit';
import { projects } from '$lib/content/projects';
import type { EntryGenerator, PageLoad } from './$types';

// One prerendered page per project (deep links, search engines). The (site) layout draws the scene and
// the overlay from `data.project`.
export const entries: EntryGenerator = () => projects.map((project) => ({ slug: project.slug }));

export const load: PageLoad = ({ params }) => {
	const project = projects.find((p) => p.slug === params.slug);
	if (!project) error(404, 'No such project');
	return { project };
};
