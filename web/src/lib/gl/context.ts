import { getContext, setContext } from 'svelte';
import type { Renderer } from './renderer';

const KEY = Symbol('renderer');

/** Root layout only: makes the site's renderer available to every page. */
export function setRenderer(renderer: Renderer) {
	setContext(KEY, renderer);
}

/** The site's renderer. Call during component init, then attach views with `{@attach renderer.view(drawable)}`. */
export function getRenderer(): Renderer {
	const renderer = getContext<Renderer | undefined>(KEY);
	if (!renderer) throw new Error('getRenderer() must be called from a component inside the root layout');
	return renderer;
}
