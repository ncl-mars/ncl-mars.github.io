/// <reference types="vite-plugin-glsl/ext" />

// Texture imports go through imagetools and end with `format=webp`, e.g.
// `import url from '$lib/assets/projects/x/thumb.jpg?w=512&h=512&fit=cover&format=webp'`.
// The default export is the URL of the generated file.
declare module '*format=webp' {
	const url: string;
	export default url;
}
