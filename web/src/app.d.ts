// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Project } from '$lib/content/projects';

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		interface PageData {
			/** Set on /projects/<slug>/: the (site) layout shows it over the scene. */
			project?: Project;
		}
		interface PageState {
			/** The overlay was opened by arriving at its POI: closing it is a step back in history. */
			fromScene?: boolean;
		}
		// interface Platform {}
	}
}

export {};
