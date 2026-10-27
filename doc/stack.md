# Web stack

What the site is built with, why, and the rules that come with each choice. Installed versions are listed under **Versions**.

Related: [project-structure.md](project-structure.md), [home-concept.md](home-concept.md), [formats/](formats/).

---

## Overview

| Layer | Choice | Role |
|-------|--------|------|
| Runtime / build | Node 22 (`.nvmrc`), npm, Vite (comes with SvelteKit) | dev server, build |
| Framework | **SvelteKit 2 + Svelte 5 (runes), TypeScript** | routing, data loading, client-side navigation |
| Output | `adapter-static`, every route prerendered | plain HTML/JS/CSS for GitHub Pages |
| Rendering | **raw WebGL2 + twgl.js** | everything on screen that isn't DOM |
| Shaders | `vite-plugin-glsl` | `.vert` / `.frag` / `.glsl` with `#include` |
| Images | `@sveltejs/enhanced-img` (includes `vite-imagetools`) | AVIF/WebP at build time; texture URLs |
| Binary data | Vite `?url` imports + JSON imports | heightmap, maps metadata, splats |
| Workers | Vite module workers | splat sort (M5) |
| Styling | plain scoped CSS in Svelte components, custom properties | no CSS framework, no preprocessor |
| Checks | `svelte-check` + TS strict (`npm run check`) | |
| Deploy | GitHub Actions → GitHub Pages | |

All npm commands run from `web/`. This machine's default Node is 22.12.0 and **stays that way** (Mont-Blanc pins it), so no nvm switching; `.nvmrc` is for CI.

**Why SvelteKit 2, not 3:** SvelteKit 3 needs Node ≥ 22.17. SvelteKit 2.70 runs on 22.12 and still uses the current toolchain (Vite 8, vite-plugin-svelte 7, TypeScript 6). `web/.npmrc` has `engine-strict=true`, so npm refuses any package that needs a newer Node. Moving to SvelteKit 3 later is mechanical: the config moves into `vite.config.ts`, and `$lib` becomes `#lib`.

## Versions

Installed in M0 (2026-10-27). `web/package-lock.json` has the exact tree.

| Package | Version |
|---------|---------|
| `@sveltejs/kit` | 2.70.3 |
| `svelte` | 5.57.3 |
| `vite` | 8.3.5 |
| `@sveltejs/vite-plugin-svelte` | 7.3.1 |
| `@sveltejs/adapter-static` | 3.0.10 |
| `@sveltejs/enhanced-img` | 1.0.0 |
| `vite-plugin-glsl` | 1.6.2 |
| `twgl.js` | 7.0.0 |
| `typescript` | 6.0.3 |
| `svelte-check` | 4.7.7 |

## Coming from Mont-Blanc

- **Same:** Node 22, Svelte 5 runes with stores in `.svelte.ts`, TypeScript with `svelte-check` only, twgl.js for raw WebGL2, `.frag` files, and the perf rules (no layout reads per frame, ResizeObserver, idle when not visible, perf panel stubbed out of the build).
- **Different:**
  - SvelteKit instead of a plain Vite library build, because the site needs real prerendered pages.
  - No three.js: the twgl layer is the whole renderer.
  - `vite-plugin-glsl` instead of `?raw`, for `#include`.
  - Assets are imported (hashed URLs) instead of loaded from `public/` through `assetUrl()`.

## SvelteKit

**Used for:**
- routes: `+layout.svelte` (owns the canvas), `/`, `/projects/[slug]`;
- `entries()` + `load` to prerender project pages from `projects.ts`;
- `preloadData` on hover, `goto` after the dive;
- `snapshot` to restore the camera on back/forward;
- `onNavigate` for shader transitions (M7);
- `{@attach}` (or an action) to register views with the renderer.

**Rules:**
1. **No browser code during prerender.** Pages are prerendered in Node, so there's no `window`, `document` or GL at module top level. The renderer starts in `onMount` in the root layout. Use `browser` from `$app/environment` when needed.
2. **The render loop stays outside Svelte reactivity.** Renderer, camera, wind and terrain-cache state are plain TS modules or classes. Per-frame DOM updates (label positions) write `el.style.transform` directly, never through `$state`. Runes are for UI state only: hovered project, loading, menus.
3. **Fixed-URL files in `static/` go through `base`** from `$app/paths`. Imported assets handle the base path themselves.
4. Every route is prerendered (`export const prerender = true` in the root `+layout.ts`), with `trailingSlash = 'always'`, so each page is written as `<route>/index.html`, which any static host serves.
5. Config lives in `web/svelte.config.js` (adapter) and `web/vite.config.ts` (plugins). Imports use `$lib`.

## WebGL2

**Target: WebGL 2.0 only** (the OpenGL ES 3.0 feature set, GLSL ES 3.00). About 97% browser coverage. No required extensions.

**Core features we rely on:**

| Feature | Used for |
|---------|----------|
| `R16F` textures with LINEAR filtering | heightmap |
| `TEXTURE_2D_ARRAY` | project thumbnails |
| `texelFetch`, integer textures (`RGBA32UI`, `usampler2D`) | square state, splat packing |
| Instancing, `gl_VertexID`, `gl_InstanceID`, VAOs | cords, stakes, splats |
| Texture fetch in the vertex shader | cords resting on the terrain |
| `gl_FragDepth` + `DEPTH_COMPONENT24` textures in FBOs | terrain cache, depth compositing |
| Transform feedback + `RASTERIZER_DISCARD` | particles |
| Non-power-of-two textures with mipmaps | maps, thumbnails |

**What WebGL2 lacks, and how we work around it:**
- No compute shaders → transform feedback for particles, a CPU worker sort for splats.
- No geometry or tessellation shaders → curves are instanced strips evaluated in the vertex shader.
- No guaranteed float render targets (`EXT_color_buffer_float`) → we never render into float textures. Render targets are `RGBA8` plus depth textures. Float data only lives in textures we sample (heightmap) or in buffers (particles).
- No guaranteed `R32F` filtering → the heightmap is `R16F`.
- `gl.LINES` is stuck at 1 px without anti-aliasing → cords are triangle strips.

**Optional extensions, used only if present:**
- `KHR_parallel_shader_compile`: compile shaders without freezing the page.
- `EXT_disjoint_timer_query_webgl2`: GPU timings in the perf HUD (dev only; often unavailable, so fall back to frame times).

**Context:** `depth: true`, `antialias: false`, `premultipliedAlpha: true`. Handle `webglcontextlost` / `webglcontextrestored`.

**No WebGL2:** the page still works through the DOM: a grid of project links over a static image.

## twgl.js

- **twgl handles:** program compile/link with readable errors (`createProgramInfo`), `setUniforms` by name, buffers and VAOs, textures (`createTexture` with `internalFormat`, `type`, `unpackAlignment`), FBOs (`createFramebufferInfo`), and `m4`/`v3` math. `m4` is column-major `Float32Array`; use the `dst` variants to avoid per-frame allocations. `m4.lookAt` returns the camera's world matrix; the view matrix is its inverse.
- **Ours:** views, render loop, camera, picking, terrain cache, asset loaders.

## Shaders

- `.vert` / `.frag` per program; shared chunks are `.glsl`, in `web/src/lib/gl/chunks/` (noise, wind, fog, height, sdf, common). Each drawable keeps its own shaders next to its TS in `web/src/lib/drawables/<name>/`.
- Includes: `#include /noise;` loads `web/src/lib/gl/chunks/noise.glsl` from any shader (plugin option `root`). `#include ./local;` is relative to the current file. The extension defaults to `.glsl`.
- Types for shader imports come from `vite-plugin-glsl/ext`, referenced in `web/src/ambient.d.ts`.
- **First line is `#version 300 es`**, before any `#include`.
- **Fragment shaders declare `precision highp float;`.** WebGL2 guarantees highp in fragment shaders, and the raymarch and fog break with mediump on phones.
- **Hot reload:** each shader file is a Vite module, so editing one recompiles just that program in place (`import.meta.hot.accept`). The GL context, camera and terrain cache survive. Set this up in M1.

## Images and binary assets

- **`<img>` tags:** `<enhanced:img>` (AVIF/WebP with srcset). Only works on files in `src/`, not `static/`.
- **Textures:** imported through imagetools directives to get a URL. For example, thumbnails use `?w=512&h=512&fit=cover&format=webp`, and the terrain maps use `?lossless&format=webp`.
  - **Convention: texture imports end with `format=webp`.** That's the pattern `web/src/ambient.d.ts` types as a URL string.
  - imagetools comes with `enhancedImages()`, which registers it for every image import. Don't add a second `imagetools()` plugin, or every image gets processed twice.
- **Data textures** (terrain maps): decode with `createImageBitmap(..., { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })` and upload as `RGBA8`, not sRGB.
- **Binary files:** `.bin` imported with `?url`, `.json` imported directly. Formats are specified in [formats/](formats/).
- Pipeline exports live in `web/src/lib/assets/<feature>/`. `static/` only holds files that need a fixed URL (favicon, robots.txt, CNAME).

## Workers

- Vite module workers: `new Worker(new URL('./sort.worker.ts', import.meta.url), { type: 'module' })`.
- Created in the browser only (from `onMount`), never during prerender.
- Results go back as transferables (`Uint32Array` buffers).

## Dev tools (not dependencies)

- **Spector.js** (browser extension): WebGL frame capture, for debugging the terrain cache, FBOs and depth compositing.
- Perf HUD in dev builds (fps, frame time, programs, textures, context id), stubbed out of production like Mont-Blanc's perf panel.

## Rejected

| Option | Why not |
|--------|---------|
| three.js or any 3D engine | the renderer is the point of the portfolio; full control over passes, caching and cost |
| WebGPU | ~88% browser coverage vs ~97% for WebGL2 |
| React, CSS frameworks | not needed |
| `?raw` shader imports | no `#include` |
| Heightmap as PNG through `<img>` | reduced to 8 bits, so visible terracing |
| `R32F` heightmap | linear filtering needs an extension some phones lack |
| Runtime shadows / AO | baked in Houdini instead (static terrain, fixed sun) |
| Gaussian splats for the terrain | full-screen overdraw, tens of MB, no surface for grid/pits/picking. Splats are used for finds only. |

## Open decisions

| # | Question | Options |
|---|----------|---------|
| S1 | Styles | **Decided: plain CSS** (native nesting, custom properties; switching to SCSS later is cheap) |
| S2 | Gestures | native Pointer Events (recommended: pan + pinch + tap only, no dependency) or hammerjs (familiar, unmaintained since 2016) |
| S3 | Formatting / linting | **Decided: `svelte-check` only** (like Mont-Blanc); Prettier can be added later |
| S4 | Tests | none, or Vitest for the pure TS math (half-float conversion, format parsing, CPU picking, camera) |
