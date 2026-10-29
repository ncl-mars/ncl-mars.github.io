/**
 * Tunable values (camera, controls, march, shading, fog, renderer). Defaults live in defaults.json; the
 * code reads `tuning` live (every frame or every event), so the dev panel's edits apply immediately.
 * To add a value: add it to defaults.json, describe it in schema.ts, read it from `tuning`.
 */
import defaults from './defaults.json';

export type Tuning = typeof defaults;
export type TuningValue = number | number[];

/** Live values. Group objects keep their identity; only their values change. */
export const tuning: Tuning = structuredClone(defaults);

let saved: Tuning = structuredClone(defaults);

/** The values currently in defaults.json (what the panel's Reset goes back to). */
export function savedDefaults(): Tuning {
	return saved;
}

type Listener = (group: string, key: string) => void;
const listeners = new Set<Listener>();

/** For values that need an action when they change (e.g. the pixel-ratio cap re-sizes the canvas). */
export function onTuningChange(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Dev panel: set one value and notify. */
export function setTuning(group: string, key: string, value: TuningValue) {
	(tuning as unknown as Record<string, Record<string, TuningValue>>)[group][key] = value;
	for (const listener of listeners) listener(group, key);
}

/** Live read-outs shown by the dev panel (e.g. the camera's current pitch), registered by pages. */
export const readouts = new Map<string, () => string>();

/** Dev panel buttons registered by pages (e.g. Copy pose), by label. The returned text shows as a status. */
export const actions = new Map<string, () => string | void | Promise<string | void>>();

// defaults.json changed (panel Save, or edited / checked out): no app reload. The new file becomes the
// saved values, and the live values are updated in place (group objects keep their identity), with
// listeners notified. Browser only: the server render has no HMR, so vite.config.ts (tuningSave) reloads
// this module there instead.
if (import.meta.hot) {
	import.meta.hot.accept('./defaults.json', (module) => {
		if (!module) return;
		saved = structuredClone(module.default as Tuning);
		const live = tuning as unknown as Record<string, Record<string, TuningValue>>;
		const next = saved as unknown as Record<string, Record<string, TuningValue>>;
		// Groups and keys removed from the file are removed live too (Save checks the shape)
		for (const group of Object.keys(live)) {
			if (!(group in next)) delete live[group];
			else for (const key of Object.keys(live[group])) if (!(key in next[group])) delete live[group][key];
		}
		for (const group of Object.keys(next)) {
			live[group] ??= {};
			for (const key of Object.keys(next[group])) {
				const value = next[group][key];
				if (JSON.stringify(live[group][key]) === JSON.stringify(value)) continue;
				live[group][key] = structuredClone(value);
				for (const listener of listeners) listener(group, key);
			}
		}
	});
}
