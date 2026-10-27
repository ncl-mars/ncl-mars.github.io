# Portfolio — Roadmap

Living work plan. Tick boxes as we go, add notes inline, and log decisions at the bottom. Details live in the other docs; this file is the order of work.

**Status:** M0 done, except `git init` (yours). Next: M1 (renderer core).

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

`web/src/lib/gl/`: `renderer.ts`, `views.ts`, `loop.ts`, `camera.ts`, `programs.ts`, `textures.ts`, `assets.ts`, `chunks/`. Drawables in `web/src/lib/drawables/<name>/`.

- [ ] Root layout creates the canvas (`position: fixed; inset: 0; z-index: -1; pointer-events: none`) and starts the renderer in `onMount`; pages reach it through Svelte context
- [ ] Context: `depth: true`, `antialias: false`, `premultipliedAlpha: true`; `webglcontextlost` → `preventDefault` + log
- [ ] View API: `{@attach}` (or an action) registers `{ el, drawable }`, unregisters on destroy
- [ ] Drawable interface: `draw(gl, view, frame, target)` (`target` may be an FBO), pass order opaque → transparent, optional `update(frame)` before drawing
- [ ] Rect cache in document space, read only in ResizeObserver callbacks (each view + root element), window resize and `document.fonts.ready`; IntersectionObserver for visibility; passive scroll listener for the offset
- [ ] Per frame: plain arithmetic to the GL rect (Y flipped), scissor + viewport
- [ ] Loop gating: rAF only while a view is visible and `visibilityState === 'visible'`
- [ ] `maxPixelRatio` config
- [ ] Shader hot reload: editing a `.vert`/`.frag` recompiles that program in place (`import.meta.hot.accept`)
- [ ] `KHR_parallel_shader_compile` when available
- [ ] Perf HUD in dev (fps, frame time, context id, programs, textures), stubbed out of production

**Watch:** a fixed canvas can trail native scrolling by a frame on some browsers ("swimming" views). Measure it here.

**Done when:** a test view draws a quad in the right place while scrolling and resizing, the loop stops when it's off-screen or the tab is hidden, and editing its shader hot-reloads it.

---

## M2a — Terrain

See [home-concept.md](home-concept.md) § Camera, § Terrain.

- [ ] `web/scripts/gen-terrain.mjs`: placeholder `heightmap.bin/.json` ([format](formats/heightmap.md)) **and** placeholder `maps.png/.json` ([format](formats/terrain-maps.md), simple light + AO computed from the heightmap), so this doesn't wait for the Houdini bake. Never overwrites existing exports without `--force`.
- [ ] Loaders: heightmap → `R16F` + CPU `Float32Array` copy; maps → raw `RGBA8` (no colour conversion)
- [ ] Camera: pan + zoom (dolly), fixed pitch and yaw, pan limits, collision with the CPU height, input on the view element (S2)
- [ ] Raymarch: rays from `invViewProj`, march only within the height range (enter at `max.y`, exit at `min.y`), fixed steps + binary refinement behind a strategy hook, writes `gl_FragDepth`
- [ ] Surface/shading split: the surface stage outputs position, normal, depth; the shading stage is a shared chunk
- [ ] Shading from the maps (light, AO, cavity → near-gray), height functions `terrainHeight()` / `height()` in a chunk
- [ ] Houdini heightmap export snippet (`hou/snippets/export_heightmap.py`) + orientation check with the test pattern. The maps export follows [terrain-maps.md](formats/terrain-maps.md).
- [ ] **Performance gate** on the Q4 device: ≥ 60 fps desktop, ≥ 30 fps on the device at the DPR cap. If it misses, the surface stage becomes the displaced mesh (plan B), possibly per device.

**Done when:** `/` shows the terrain, pan and zoom work, and the gate is measured and recorded below.

---

## M2b — Atmosphere

See [home-concept.md](home-concept.md) § Frame structure, § Wind and mist.

- [ ] Terrain cache: FBO with `RGBA8` colour + `DEPTH_COMPONENT24` texture, at a render scale; re-marched only when the camera moves, a square animates or the view resizes
- [ ] Mist composite pass every frame: cached colour + depth → world position → fog → colour + `gl_FragDepth`
- [ ] `wind.glsl` chunk (`windScroll()`, `gust()`) and `fog.glsl` chunk (closed-form height fog, wind-scrolled banks, brighter toward the sun)

**Done when:** the mist drifts with the wind, and idle frames don't re-march the terrain (visible in the HUD).

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

## M3 — Project pages + the dive

- [ ] `web/src/routes/projects/[slug]/` with `entries()` + `load` from `projects.ts`
- [ ] Image drawable (textured quad, cover-fit UVs, texture cache by URL across navigations); non-GL images via `<enhanced:img>`
- [ ] The dive (see [home-concept.md](home-concept.md) § Click, § The pit):
  - input locked, camera eases from oblique to top-down into the square (terrain re-marched every frame)
  - dig progress 0→1: analytic pit in `height()`, sloped/benched walls, procedural strata
  - final frame = thumbnail filling the view → `goto`; the project page opens with the same image as its hero, in the same place
  - back: camera state restored, the rise plays in reverse; `snapshot` for back/forward

**Done when:** `/` → dive → project → back works, reusing the same canvas and GL context (same context id in the HUD, no recompiled programs). `build` outputs a static site and `check` passes.

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

Finds revealed in dug squares (see [home-concept.md](home-concept.md) § Splat finds). Rendering in WebGL2: a CPU sort in a worker, instanced quads, premultiplied blending. With the pan-only camera, a find is sorted once and re-sorted only during the dive. Fill rate is the main cost, so scenes stay small.

### M5a — Spike (time-box ~2 sessions, hidden `/lab/splat` route)

- [ ] Loader for the Q3 format (test file you export to `web/src/lib/assets/splats/`); spec in `doc/formats/splat.md`
- [ ] Pack into an `RGBA32UI` texture, 2 texels per splat (position f32×3 + RGBA8; covariance 6×f16 precomputed at load)
- [ ] Sort worker: view depth → 16-bit counting sort → `Uint32Array` transferable → instanced index buffer
- [ ] Vertex shader: covariance projection → 2D eigen → quad, ~0.3 px dilation, culling; fragment: Gaussian falloff, premultiplied, alpha threshold
- [ ] Blending back-to-front `ONE, ONE_MINUS_SRC_ALPHA`, depth test on, depth write off
- [ ] Measure on desktop + Q4 device: fps, sort ms, memory, download size

**Go/no-go:** ≥ 60 fps desktop, ≥ 30 fps on the Q4 device with a find on screen, no visible popping during the dive, ≤ ~5 MB per find.

### M5b — Integration

- [ ] Finds placed in their squares, revealed by the dig progress, composited against the terrain depth, fogged per splat
- [ ] Re-sort during the dive only; progressive loading
- [ ] Optional: SH degree 1, SPZ decode (`DecompressionStream`)

---

## M6 — Real terrain + acceleration

- [ ] Swap the placeholders for the Houdini heightmap and baked maps; tune bounds, fog and grid
- [ ] If the gate needs it: max-height mip pyramid (explicit mip uploads) or cone map (`RG16F`), through the strategy hook

---

## M7 — Transitions polish

- [ ] Render-to-texture through the drawable `target` (RGBA8 FBOs)
- [ ] Sequence with `onNavigate` for every navigation, not just the dive; coordinate the DOM fade; respect `prefers-reduced-motion`

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

- **2026-10-27**: M0 done. SvelteKit 2.70 instead of 3: SvelteKit 3 needs Node ≥ 22.17, and the default Node stays 22.12 so Mont-Blanc isn't affected. Vite 8, Svelte 5, TS 6, `engine-strict=true`. Houdini folder is `hou/` (yours, already there). Texture imports end with `format=webp`; GLSL root includes are `#include /name;`.
- **2026-10-27**: Roadmap synced with the docs. M2 split into M2a–M2d; the dive moved into M3 (it needs a project page to land on). Locked decisions now live in [stack.md](stack.md).
- **2026-10-27**: Working rules: Claude writes the code inside this folder only (nothing outside it without agreement) and doesn't touch files you are tuning live without asking. You run all git commands; Claude suggests commit messages, with no `Co-Authored-By` line. S1: plain CSS.
- **2026-10-27**: Home concept revision 2: pan + zoom camera, grayscale maps baked in Houdini (light/AO/cavity + `sunDir`), splats for finds only (not the terrain), stakes + cords as GPU curves with wind, shared wind field, heavy height fog, terrain cache, surface/shading split with a mesh fallback, performance gate in M2a.
- **2026-10-27**: WebGL2 only, no required extensions. Web stack written up in [stack.md](stack.md).
- **2026-10-27**: Project structure: app in `web/`, Houdini in `houdini/`, docs and format specs in `doc/`. Pipeline exports go into `web/src/lib/assets/` and are imported.
- **2026-10-27**: Roadmap created. Gaussian splats evaluated: feasible in raw WebGL2 with a worker CPU sort.
