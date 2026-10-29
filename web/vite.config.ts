import { sveltekit } from '@sveltejs/kit/vite';
import { enhancedImages } from '@sveltejs/enhanced-img';
import glsl from 'vite-plugin-glsl';
import { defineConfig, normalizePath, type Plugin } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { formatTuning, sameShape } from './src/lib/tuning/format.ts';

export default defineConfig({
	plugins: [
		// Also registers the imagetools instance that texture imports (`?w=512&format=webp`) go through.
		// Don't add a second imagetools() plugin: every image would be processed twice.
		enhancedImages(),
		// `#include /noise;` resolves from src/lib/gl/chunks (relative to web/, where npm runs vite)
		glsl({ root: '/src/lib/gl/chunks' }),
		projectFiles(),
		tuningSave(),
		sveltekit()
	]
});

/**
 * Content files become modules at build time, so the browser gets plain data (lib/content/ checks it):
 * - `.yaml` files (src/lib/assets/portfolio.yaml, format: doc/formats/portfolio.md): parsed;
 * - project text files (src/lib/assets/projects/<id>/project.md, format: doc/formats/projects.md): the
 *   YAML header between the `---` lines parsed, the text under it split into paragraphs (blank lines
 *   between them).
 */
function projectFiles(): Plugin {
	return {
		name: 'project-files',
		enforce: 'pre',
		transform(code, id) {
			const file = id.split('?')[0];
			if (file.endsWith('.yaml')) return { code: `export default ${JSON.stringify(parseYaml(code) ?? null)};`, map: null };
			if (!file.endsWith('/project.md')) return;
			const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/.exec(code);
			if (!match) throw new Error(`${file}: no header (the YAML between two --- lines, at the top)`);
			const header = parseYaml(match[1]) ?? {};
			if (typeof header !== 'object' || Array.isArray(header)) throw new Error(`${file}: the header must be "key: value" lines`);
			const presentation = (match[2] ?? '')
				.split(/\r?\n[ \t]*\r?\n/)
				.map((paragraph) => paragraph.replace(/\s*\r?\n\s*/g, ' ').trim())
				.filter(Boolean);
			return { code: `export default ${JSON.stringify({ ...header, presentation })};`, map: null };
		}
	};
}

/**
 * Dev server only: the dev panel's "Save defaults" POSTs the tuning values here, and they are written to
 * src/lib/tuning/defaults.json, after checking they have the same groups, keys and types as the file.
 * Also keeps the server render in step: tuning/index.ts accepts defaults.json updates (the browser updates
 * the live values in place), but the server render has no HMR, so there nothing would ever reload it and
 * its values would go stale (a new group read during the render then throws). On a change, it is
 * invalidated on the server, with everything that imports it.
 */
function tuningSave(): Plugin {
	const file = fileURLToPath(new URL('./src/lib/tuning/defaults.json', import.meta.url));
	const tuningModule = normalizePath(fileURLToPath(new URL('./src/lib/tuning/index.ts', import.meta.url)));
	return {
		name: 'tuning-save',
		apply: 'serve',
		hotUpdate({ file: changed }) {
			if (this.environment.name !== 'ssr' || changed !== normalizePath(file)) return;
			const graph = this.environment.moduleGraph;
			for (const mod of graph.getModulesByFile(tuningModule) ?? []) graph.invalidateModule(mod);
		},
		configureServer(server) {
			server.middlewares.use('/__tuning/save', (req, res) => {
				if (req.method !== 'POST') {
					res.statusCode = 405;
					res.end();
					return;
				}
				let body = '';
				req.on('data', (chunk) => (body += chunk));
				req.on('end', async () => {
					try {
						const data = JSON.parse(body);
						const current = JSON.parse(await readFile(file, 'utf8'));
						if (!sameShape(current, data)) throw new Error('values do not match the shape of defaults.json');
						await writeFile(file, formatTuning(data));
						res.statusCode = 204;
						res.end();
					} catch (error) {
						res.statusCode = 400;
						res.end(error instanceof Error ? error.message : String(error));
					}
				});
			});
		}
	};
}
