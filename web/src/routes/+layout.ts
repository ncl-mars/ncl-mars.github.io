// Static site: every route is prerendered to HTML at build time.
export const prerender = true;

// Each page is written as <route>/index.html, which any static host (GitHub Pages included) serves.
export const trailingSlash = 'always';
