# Portfolio — Roadmap

Living work plan. Tick boxes as we go, add notes inline, and log decisions at the bottom. Details live in the other docs; this file is the order of work.

**Status (2026-10-28):** M0–M2b merged into `develop` (pending your merge of M2b). On `feature/m3a-core-viewer`: the core viewer prototype on `/lab/core`, browser check pending.

**Next:**
- Claude: iterate on the core viewer from your feedback, then M2c (cords) / M2d (squares) / M3c (integration).
- You, whenever:
  - tune the camera in the panel → Save defaults → commit `defaults.json`;
  - perf gate: `npm run dev -- --host`, phone fps + model (answers Q4);
  - orientation check with a first Houdini export (`hou/snippets/export_heightmap.py`).

**Docs:** [stack.md](stack.md) (web stack and rules) · [home-concept.md](home-concept.md) (home page) · [project-structure.md](project-structure.md) · [formats/](formats/) (heightmap, terrain maps)

---

## Open questions

| # | Question | Needed by | Answer |
|---|----------|-----------|--------|
| Q1 | Pages URL: `<user>.github.io` repo, custom domain, or project repo (needs `paths.base`)? | M4 | |
| Q2 | Splat finds: home page pits only, or also on project pages? | M5 | Home pits for sure; project pages open |
| Q3 | Splat file format: own packed `.bin` + `.json` (recommended) or PLY? | M5a | |
| Q4 | Reference weak device (phone/GPU) for the performance gate, and max pixel ratio | M2a | |
| Q5 | Max splat count per find, SH degree (0 = baked color)? | M5a | |

Stack choices S1–S4 are tracked in [stack.md](stack.md#open-decisions).

---

## M0 — Scaffold

- [x] Node 22.12.0 (default, unchanged); `.nvmrc` at repo root for CI
- [x] SvelteKit **2** (minimal, TS) in `web/`. SvelteKit 3 needs Node ≥ 22.17; see [stack.md](stack.md#versions).
- [x] `adapter-static`, `prerender = true` + `trailingSlash = 'always'` in root `+layout.ts`
- [x] `vite-plugin-glsl` (`root` = chunks folder) and `@sveltejs/enhanced-img` in `vite.config.ts`. enhanced-img already registers imagetools, so no second `imagetools()` plugin.
- [x] Type declarations in `web/src/ambient.d.ts`: shader imports (`vite-plugin-glsl/ext`), texture imports ending with `format=webp`
- [x] S1 plain CSS, S3 `svelte-check` only
- [x] Root files: `.gitignore`, `.gitattributes` (binaries), `.vscode/settings.json` + `extensions.json`
- [ ] `git init`: **you run it** (all git commands are yours; Claude suggests commit messages, never with a `Co-Authored-By` line)
- [x] `CLAUDE.md` (repo root): working rules, docs, commands

**Done when:** `npm run dev`, `npm run build` and `npm run check` run clean on the empty app.

---

## M1 — Renderer core (shared canvas + views)

`web/src/lib/gl/`: `renderer.ts` (views, loop, sizing, context), `programs.ts` (cache + hot swap), `types.ts`, `context.ts`, `fullscreen.vert`, `chunks/`. Drawables in `web/src/lib/drawables/<name>/` (`test/` for now). `camera.ts`, `textures.ts` and `assets.ts` come with M2a/M3, when something uses them.

- [x] Root layout creates the canvas (`position: fixed; inset: 0; z-index: -1; pointer-events: none`) and the renderer; pages reach it with `getRenderer()`
- [x] Context: `alpha`, `depth: true`, `antialias: false`, `premultipliedAlpha: true`. Context loss → `preventDefault`; on restore, drawables are re-initialised (basic recovery already)
- [x] View API: `{@attach renderer.view(drawable)}` registers, unregisters on destroy. Views registered before the canvas exists are initialised at mount.
- [x] Drawable interface: `init` / `update(frame)` / `draw(gl, ctx)` / `dispose`; `ctx` has the view's pixel rect and `target` (FBO or null). Pass order is the drawable's business (a scene drawable draws opaque, then transparent).
- [x] Rect cache in document space, read only in ResizeObserver callbacks (canvas, each view, root element), window resize, pixel-ratio change and `document.fonts.ready`; passive scroll listener for the offset
- [x] Visibility is computed from the cached rects + scroll offset (arithmetic, exact, no async lag) instead of IntersectionObserver
- [x] Per frame: plain arithmetic to the GL rect (Y flipped, edges rounded separately), viewport + scissor clipped to the canvas; zero allocations
- [x] Loop gating: rAF only while a view is visible and the tab is visible; the canvas is cleared when the last view leaves the screen
- [x] `maxPixelRatio` option (default 2)
- [x] Program cache keyed by sources: drawables re-created by navigation reuse compiled programs
- [x] Shader hot reload: `hotSwap()` from the drawable module's `import.meta.hot.accept`; a broken edit logs the error and keeps the old program running
- [ ] `KHR_parallel_shader_compile`: deferred. twgl's `createProgramInfoAsync` uses it; switch when there are enough programs for compile time to matter.
- [x] Perf HUD in dev (context id, running/idle, fps, CPU ms, views, programs, compiles, canvas size), toggle with P, not in production builds (checked)
- [x] Test page `/lab/views/`: four test-pattern views with spacers, link home and back

**Watch:** a fixed canvas can trail native scrolling by a frame on some browsers ("swimming" views). Measure it here.

**Done when:** a test view draws a quad in the right place while scrolling and resizing, the loop stops when it's off-screen or the tab is hidden, and editing its shader hot-reloads it.

---

## M2a — Terrain

See [home-concept.md](home-concept.md) § Camera, § Terrain.

- [x] `web/scripts/gen-terrain.mjs` (`npm run gen:terrain`): placeholder 1024² heightmap (fbm + ridges + a flat central plateau for the dig) and maps (light with soft shadows from `sunDir`, horizon AO, cavity), in the spec formats, no dependencies. Never overwrites without `--force`.
- [x] Loaders: heightmap → CPU `Heightfield` (half → float lookup table, GL-matching bilinear `heightAt`) + `R16F` texture; maps → raw `RGBA8` (no colour conversion, mipmapped). Textures cached per context (`renderer.resource`), so navigation doesn't reload them.
- [x] Maps imported as `?lossless&format=webp`: checked bit-identical to the PNG after the build
- [x] Camera (`gl/camera.ts`): pan + zoom, yaw 0 / fov 35°, **pitch from the zoom** (60° far → 25° near, tilting up as it dives in), pan limits = bounds − 10 %, target follows the ground, eye kept above it. Smooth zoom, inertia and keyboard are eased in `update()`. Module-level on the home page, so it survives navigation.
- [x] Controls (`gl/controls.ts`, S2 = native Pointer Events): drag grabs the real ground (CPU `Heightfield.raycast`) with inertia on release; wheel / trackpad pinch glide-zoom toward the pointer; two-finger pinch; double-click / double-tap zoom in; arrows / WASD / ZQSD + `+`/`−` when focused
- [x] Raymarch: rays from `invViewProj`, march only inside the terrain's box, **height-relative steps** (`uStepScale` 0.45, `uPrecision` 0.0015, cap `uSteps` 128) + binary refinement (6), `marchSurface()` is the strategy hook, writes `gl_FragDepth`
- [x] Surface/shading split: `surface.glsl` (the `Surface` struct), `march.glsl` (surface stage), `shade.glsl` (shading stage)
- [x] Shading from the maps (light, AO, cavity → near-gray, light distance fog for now); `terrainHeight()` / `height()` / `terrainNormal()` in `gl/chunks/terrain.glsl`
- [x] Fade-in once loaded; tuning from the URL: `?steps=48`, `?dpr=1`
- [x] Houdini heightmap export snippet: `hou/snippets/export_heightmap.py` (detects axis flips/swaps)
- [ ] Orientation check with the test pattern (yours, after a first export)
- [ ] **Performance gate** on the Q4 device: ≥ 60 fps desktop, ≥ 30 fps on the device at the DPR cap. If it misses, the surface stage becomes the displaced mesh (plan B), possibly per device. To test a phone on the same Wi-Fi: `npm run dev -- --host`.

**Done when:** `/` shows the terrain, pan and zoom work, and the gate is measured and recorded below.

---

## M2b — Atmosphere

See [home-concept.md](home-concept.md) § Frame structure, § Wind and mist.

- [x] Endless terrain: procedural far field around the heightmap (`terrain.glsl` + its TS mirror `terrain/farfield.ts`), blend band, slab-bounded march capped at the fog end, far-field shading from `sunDir`, sky gradient, page background = fog colour; CPU `Ground` (heights + raycast) for the camera and picking
- [x] Camera change signal: `camera.revision` moves only when the view-projection matrix changes; every easing snaps to its goal so a still camera is exactly still
- [x] Terrain cache (`gl/targets.ts`: RGBA8 + `DEPTH_COMPONENT24`), at `march.renderScale`; re-marched only when the camera revision, the view size, a ground setting (`terrain.invalidate()` from panel edits) or the march shader (hot reload) changes
- [x] Composite pass every frame (`composite.frag`): cached colour + depth → world position → atmosphere → colour + `gl_FragDepth`
- [x] Chunks: `noise.glsl` (shared hash + value noise), `wind.glsl` (`windScroll()`), `fog.glsl` (distance fog, closed-form height mist, two-layer wind-scrolled banks, sun glow, sky). `gust()` for the cords comes with M2c.
- [x] Panel: render scale; Mist (density, base height, falloff, banks, bank size); Wind (direction, speed); sun glow colour/strength/tightness; readout "terrain cached / marching · N marches"
- [ ] Browser check (yours): mist drifts, and the readout says **cached** while the camera is still

**Done when:** the mist drifts with the wind, and idle frames don't re-march the terrain (visible in the dev panel).

---

## M2c — Grid: stakes and cords

See [home-concept.md](home-concept.md) § Grid.

- [ ] Grid parameters (origin, cell size, N×M), letter/number naming
- [ ] Stakes: instanced, at `terrainHeight` + offset
- [ ] Cords as GPU curves: instanced strip from `gl_VertexID`, constant pixel width, anti-aliased edges, sub-pixel fade, near-plane clamp
- [ ] Curve: sag → wind → rest on bumps
- [ ] Cord shadows projected along `sunDir`, with depth bias
- [ ] Fog on stakes, cords and shadows; accent colour for project squares
- [ ] DOM labels projected per frame, as real links

**Done when:** the grid is visible and the cords sway with gusts that match the mist.

---

## M2d — Squares and hover

See [home-concept.md](home-concept.md) § Square state, § Hover.

- [ ] `web/src/lib/content/projects.ts` with `cell` and thumbnail per project (one example project to start)
- [ ] Square state texture (RGBA8, `texSubImage2D` on change)
- [ ] CPU picking (same march as the GLSL)
- [ ] Hover: flat slab (per-square plate height precomputed at load), thumbnail from a `TEXTURE_2D_ARRAY`, emissive, the square's 4 cords highlighted
- [ ] Keyboard focus on a label = hover; mobile: first tap = hover, second = enter
- [ ] `preloadData` + hero image preload on hover

**Done when:** hovering the example project's square shows its thumbnail on the slab.

---

## M3 — Core sample + project viewer

See [home-concept.md](home-concept.md) § Click: the core sample, § Core viewer. No page change: the project opens as a core sample cut out of its square.

### M3a — Viewer prototype (`/lab/core`, placeholder images, depth maps and text)

- [x] Placeholders: `npm run gen:lab-core` → five render-like images (lit spheres and discs, five aspect ratios) with their exact relief maps (`doc/formats/relief.md`); shared encoders in `scripts/lib/encode.mjs`
- [x] ~~First pass: mesh strata + X-ray shell~~ → replaced after review: the core is solid rock, the X-ray idea belongs to the terrain
- [x] Raymarched rock core (`drawables/core/core.frag` + `rock.glsl`): square prism SDF, walls roughened by low-frequency 3D noise (`valueNoise3` in `/noise`), dipping colour bands, grain; raking light, soft shadows, occlusion; misses discarded, depth written
- [x] ~~Value noise~~ → noise textures (`gl/noise.ts`): 64³ tileable 3D gradient noise (4 channels, ~73 ms once per context) + 256² hash; fine wavy strata bands, smooth grain
- [x] The cut: undulates with the rock's own noise; images buried one strata thickness apart, revealed by the cut (emerge highest-first, then sanded flat), plain rock between
- [x] Scroll = dig: native scroll container (fixed, tall spacer, sticky stage) drives the cut depth (eased); pointer parallax
- [x] Text in HTML beside the core (below on narrow screens), caption of the focused layer
- [x] Hit area: button mapped onto the showing image's quad on the cut face with a per-frame `matrix3d` (`gl/homography.ts`); click → `Lightbox.svelte`, a carousel (arrow buttons, ← →, swipe, wrap, directional slide; Escape / × / click outside), with the core following the image shown
- [x] Panel: Core group (strata thickness, image relief, presence, cut undulation, wall roughness, strata colours, light, shadows, occlusion, steps, framing, smoothing); readout "core focus · frames · reliefs"
- [ ] Browser check and look tuning (yours)

### M3b — Relief maps

- [x] Format spec: [formats/relief.md](formats/relief.md) (half floats + `.json`, row 0 = image top, 1 = near)
- [ ] Depth maps per project image, made in Houdini (render depth pass, or ML); ComfyUI as a fallback
- [ ] `projects.ts`: `{ slug, cell, title, text, images: [{ colour, relief, caption }] }`

### M3c — Integration with the dig site

- [ ] Cut: `height()` drops to the core depth inside the square (vertical walls), strata on the walls, driven by the square state's `b` channel
- [ ] Extract: the core lifts out of its hole, turns toward the camera and grows into the foreground (model matrix tween)
- [ ] Isolation: the dig site behind is desaturated and blurred, ramping in during the extraction (blur the still terrain cache once at half resolution, separable passes via `gl/targets.ts`; the mist composite stays live on top)
- [ ] Shallow routing: `/projects/<slug>` without leaving home; back closes; a direct visit opens the core; `routes/projects/[slug]` prerendered (home + core open) with `entries()`
- [ ] Close: ×, Escape, click outside, back → reverse animation

**Done when:** clicking a project square cuts and extracts its core, scrolling digs through its relief layers, clicking a layer shows the colour image, and back closes it, all on the same canvas and GL context. `build` outputs a static site (one HTML per project) and `check` passes.

---

## M4 — Deploy (needs Q1)

- [ ] `paths.base` / `web/static/CNAME` according to Q1
- [ ] `.github/workflows/deploy.yml`: triggered on `web/**` + the workflow file; checkout → setup-node (`node-version-file: .nvmrc`, `cache-dependency-path: web/package-lock.json`) → `npm ci` + build in `web/` → `upload-pages-artifact` (`path: web/build`) → `deploy-pages` (`pages: write`, `id-token: write`, `github-pages` environment)
- [ ] Repo Settings → Pages → Source: GitHub Actions
- [ ] 404 page; deep links and refresh on `/projects/<slug>`
- [ ] Size limits: files > 100 MB rejected on push, site ≤ 1 GB, soft bandwidth 100 GB/month

**Done when:** the live URL serves `/` and the project page, with working deep links.

---

## M5 — Splat finds

Finds in the core or at the bottom of its hole (see [home-concept.md](home-concept.md) § Splat finds). Rendering in WebGL2: a CPU sort in a worker, instanced quads, premultiplied blending. Panning never changes the view direction, so a find re-sorts only when the zoom (pitch) or the heading changes, or when the core moves. Fill rate is the main cost, so scenes stay small.

### M5a — Spike (time-box ~2 sessions, hidden `/lab/splat` route)

- [ ] Loader for the Q3 format (test file you export to `web/src/lib/assets/splats/`); spec in `doc/formats/splat.md`
- [ ] Pack into an `RGBA32UI` texture, 2 texels per splat (position f32×3 + RGBA8; covariance 6×f16 precomputed at load)
- [ ] Sort worker: view depth → 16-bit counting sort → `Uint32Array` transferable → instanced index buffer
- [ ] Vertex shader: covariance projection → 2D eigen → quad, ~0.3 px dilation, culling; fragment: Gaussian falloff, premultiplied, alpha threshold
- [ ] Blending back-to-front `ONE, ONE_MINUS_SRC_ALPHA`, depth test on, depth write off
- [ ] Measure on desktop + Q4 device: fps, sort ms, memory, download size

**Go/no-go:** ≥ 60 fps desktop, ≥ 30 fps on the Q4 device with a find on screen, no visible popping while the core moves, ≤ ~5 MB per find.

### M5b — Integration

- [ ] Finds placed in their core / hole, composited against the terrain depth, in the atmosphere
- [ ] Re-sort only on zoom, heading or core movement; progressive loading
- [ ] Optional: SH degree 1, SPZ decode (`DecompressionStream`)

---

## M6 — Real terrain + acceleration

- [ ] Swap the placeholders for the Houdini heightmap and baked maps; tune bounds, fog and grid
- [ ] If the gate needs it: max-height mip pyramid (explicit mip uploads) or cone map (`RG16F`), through the strategy hook

---

## M7 — Transitions polish

Most of the transition work moved into M3 (the core extraction). What's left:

- [ ] Any remaining navigation (other pages, if any) through `onNavigate`, coordinated with the DOM; render-to-texture via `gl/targets.ts` if needed
- [ ] `prefers-reduced-motion`: instant core open/close, no glides

---

## M8 — GPU particles

- [ ] Transform feedback ping-pong (`RASTERIZER_DISCARD`; WebGL2 still needs a trivial fragment shader)
- [ ] State: position, velocity, age/life, seed; ring-buffer emission
- [ ] Dig dust burst on enter; ambient dust carried by `wind.glsl`
- [ ] Collision with `height()` (pits included), additive, depth-tested, fogged
- [ ] Optional: verlet cords (cords twang on hover) feeding the same curve renderer

---

## M9 — Polish & robustness

- [ ] No-WebGL2 fallback: DOM grid of project links over a static image
- [ ] Full context-loss recovery (rebuild programs, textures, buffers)
- [ ] Phone perf pass: DPR cap, render scale, march steps
- [ ] `prefers-reduced-motion`, keyboard/focus, meta/OG tags, page titles
- [ ] Lighthouse pass (LCP with a full-screen canvas, CLS)

---

## Decision log

- **2026-10-28**: Core decided: extracted upward from the ground; the dig site behind is isolated by desaturation + blur (a focus pull), not a wireframe or a translucent terrain. `.venv/` (Python) added to `.gitignore`.
- **2026-10-28**: Core viewer reworked after review: a solid raymarched rock core; the cut face (low-frequency displaced) descends as you scroll; images appear as micro relief from their depth maps at their depth, plain rock between. The X-ray/translucency idea moves to the terrain; extraction upward recommended as the primary gesture, a translucent hover "lens" as an option (decide in M3c).
- **2026-10-28**: M3a viewer prototype on `/lab/core`. Depth maps come from Houdini (ComfyUI fallback). Design stance recorded: readability through discovery is intended. Relief format: half floats, row 0 = image top, near = 1.
- **2026-10-28**: Home concept revision 3: no dive, no page change. Clicking a project square cuts a square core sample; it lifts into the foreground as the project viewer (X-ray look) with the dig site live behind. Images are dipping strata carved in relief from ML depth maps (grays); scrolling digs through them; clicking one opens the colour image in an HTML lightbox. Text in HTML beside the core. One URL per project through shallow routing. M3 rewritten (M3a viewer prototype on `/lab/core`, M3b relief maps, M3c integration); M7 mostly absorbed.
- **2026-10-28**: M2b implemented: camera revision, terrain cache + composite with the whole atmosphere (fog, height mist, wind banks, sun glow). The march pass no longer applies fog. Fragment shaders using `/noise` need `precision highp int` (mobile mediump ints would break the hash).
- **2026-10-28**: Endless terrain (option 1, procedural): the heightmap fades into a value-noise far field, no X/Z bounds, everything dissolves into fog at the fog end; the page background is the fog colour; site palette now light (dark text). The CPU mirrors the far field exactly (`terrain/farfield.ts`) through `Ground`, which replaces `Heightfield.raycast`.
- **2026-10-27**: Camera polish (`feature/cam-controls`): compass (needle follows the heading, click = north), line-of-sight lift, rotation inertia, keyboard focus on load. New `renderer.onFrame()` hook for DOM overlays (the M2c labels will use it). Still to come with their milestones: a camera change signal (M2b terrain cache) and scripted moves with a pitch override (M2d / M3 dive).
- **2026-10-27**: Camera rotation added after all: free heading (right-drag / Alt+drag, two-finger twist, Q/E, N back to north), pitch still tied to zoom. Keyboard bindings by physical key position (`event.code`). The dive will ease the heading back to north so thumbnails land upright. Splats re-sort on rotation too.
- **2026-10-27**: Dev tuning panel (branch `dev-panel`): every tunable value lives in `web/src/lib/tuning/defaults.json` and is read live; the panel (dev only, P) has sliders built from `schema.ts`, live readouts, and Save / Copy / Reset. Save writes the JSON through a dev-server endpoint, no reload. Replaces the perf HUD. Camera got a `tiltCurve` value.
- **2026-10-27**: Camera pitch now follows the zoom (60° → 25°, tilting up as it dives in), so the march switched from fixed steps to height-relative steps for the grazing rays. Controls: smooth zoom, inertia, real-ground grab, double-click/tap, keyboard. Splats will re-sort on zoom changes (still never on pan).
- **2026-10-27**: M2a implemented. S2 = native Pointer Events. Camera and terrain drawable are module-level on the home page (state survives navigation). Textures are cached per context like programs. The camera target follows the ground.
- **2026-10-27**: M1 browser checks passed: mapping exact, no visible swimming, idle when nothing is on screen or the tab is hidden, programs reused across navigation, shader hot reload works. Browser zoom scales the CSS-px test grid, as expected.
- **2026-10-27**: M1 implemented. View visibility comes from cached rects (arithmetic) instead of IntersectionObserver. Pass order lives inside drawables, not in the renderer. Programs are cached by source, so navigation doesn't recompile. `KHR_parallel_shader_compile` deferred.
- **2026-10-27**: M0 done. SvelteKit 2.70 instead of 3: SvelteKit 3 needs Node ≥ 22.17, and the default Node stays 22.12 so Mont-Blanc isn't affected. Vite 8, Svelte 5, TS 6, `engine-strict=true`. Houdini folder is `hou/` (yours, already there). Texture imports end with `format=webp`; GLSL root includes are `#include /name;`.
- **2026-10-27**: Roadmap synced with the docs. M2 split into M2a–M2d; the dive moved into M3 (it needs a project page to land on). Locked decisions now live in [stack.md](stack.md).
- **2026-10-27**: Working rules: Claude writes the code inside this folder only (nothing outside it without agreement) and doesn't touch files you are tuning live without asking. You run all git commands; Claude suggests commit messages, with no `Co-Authored-By` line. S1: plain CSS.
- **2026-10-27**: Home concept revision 2: pan + zoom camera, grayscale maps baked in Houdini (light/AO/cavity + `sunDir`), splats for finds only (not the terrain), stakes + cords as GPU curves with wind, shared wind field, heavy height fog, terrain cache, surface/shading split with a mesh fallback, performance gate in M2a.
- **2026-10-27**: WebGL2 only, no required extensions. Web stack written up in [stack.md](stack.md).
- **2026-10-27**: Project structure: app in `web/`, Houdini in `houdini/`, docs and format specs in `doc/`. Pipeline exports go into `web/src/lib/assets/` and are imported.
- **2026-10-27**: Roadmap created. Gaussian splats evaluated: feasible in raw WebGL2 with a worker CPU sort.
