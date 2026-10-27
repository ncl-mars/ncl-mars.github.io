import { sveltekit } from '@sveltejs/kit/vite';
import { enhancedImages } from '@sveltejs/enhanced-img';
import glsl from 'vite-plugin-glsl';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		// Also registers the imagetools instance that texture imports (`?w=512&format=webp`) go through.
		// Don't add a second imagetools() plugin: every image would be processed twice.
		enhancedImages(),
		// `#include /noise;` resolves from src/lib/gl/chunks (relative to web/, where npm runs vite)
		glsl({ root: '/src/lib/gl/chunks' }),
		sveltekit()
	]
});
