# Portfolio — Roadmap

Living work plan. Tick boxes as we go, add notes inline, and log decisions at the bottom. Details live in the other docs; this file is the order of work.

**Status (2026-10-29):** M0–M3c, the dust (M8) and the first phone performance pass merged into `develop`. Then labels that don't overlap and stay readable in the mist (`feature/legend-collisions`). Then light shafts in the mist (M10, `feature/god-rays`). Then the rough march in motion only on slow devices (Q6), the phone menu, home as the overview. Then POIs placed from Houdini, one folder per project (M11). On `feature/legend-shadows`: the legend lines cast shadows in the god rays (M12).

**Next:**
- Deploy (M4) waits: the site stays local for now, until you decide otherwise.
- You, whenever:
  - tune the camera in the panel → Save defaults → commit `defaults.json`;
  - perf gate: `npm run dev -- --host`, phone fps + model (answers Q4);
  - orientation check with a first Houdini export (`hou/snippets/export_heightmap.py`), then the POIs (`export_pois.py`).

**Docs:** [stack.md](stack.md) (web stack and rules) · [home-concept.md](home-concept.md) (home page) · [project-structure.md](project-structure.md) · [formats/](formats/) (heightmap, terrain maps)

---

## Open questions

| # | Question | Needed by | Answer |
|---|----------|-----------|--------|
| Q1 | Pages URL: `<user>.github.io` repo, custom domain, or project repo (needs `paths.base`)? | M4 | |
| Q4 | Reference weak device (phone/GPU) for the performance gate, and max pixel ratio | M2a | Your old, cheap phone (90 Hz screen): the weakest device to support. Target 60 fps |
| Q6 | Rough march while moving (March: motion scale 0.5) applies on every device. On desktop the softness shows in motion, but it isn't disturbing. Keep it, or make it automatic: march sharp while moving, and fall back to rough only on a device whose moving frames drop under ~52 fps (desktop stays sharp, the phone switches by itself)? | M9 | Automatic (2026-10-29, `feature/adaptive-march`): March → Rough in motion, 1 by default |

| Q7 | More sites (topics: simulation, web 3D, archviz, video mapping…), each with its own POIs and a menu headed by its name, like Dig site. Is each site its own scene (its own terrain or world, its own URL), or a group of POIs in the one landscape? | Next site | No sites for now (2026-10-29): about 10 POIs at most, one list. If it comes back: groups in the one landscape by discipline (built once, commit 4c136d5), with site labels at home and POI labels inside a site; a scene per site as a later nice-to-have |

Q2, Q3, Q5 were about splats, dropped on 2026-10-29.

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
- [ ] Hover: flat slab (per-square plate height precomputed at load), thumbnail from a `TEXTURE_2D_ARRAY`, emissive, the square's 4 cords highlighted. Under review: a legend line from the square to the project's title instead.
- [ ] Keyboard focus on a label = hover; mobile: first tap = hover, second = enter
- [ ] `preloadData` + hero image preload on hover

**Done when:** hovering the example project's square shows its thumbnail on the slab.

---

## M3 — Legend lines + project view

See [home-concept.md](home-concept.md) § Legend lines, § Click: the project view. The core sample (old M3a–M3c) is dropped; its experiment is in the history (`feature/m3a-core-viewer`). Kept from it: `Lightbox.svelte` (carousel), `gl/noise.ts` (noise textures), `gl/homography.ts` (HTML on 3D quads).

### M3a — Legend lines prototype (`feature/legend-lines`)

- [x] Core viewer removed (code, `/lab/core`, placeholder assets, relief format and exporter, Core tuning group)
- [x] SVG overlay + HTML labels projected in `renderer.onFrame()` (`components/Legend.svelte`, `legend/legend.ts`): one elbow, the line draws from the anchor to the end of the shelf, then the text fades in; hidden off-screen, behind the terrain (CPU occlusion test on camera changes) or deep in the mist (CPU fog mirror `terrain/atmosphere.ts`)
- [x] Two layouts to compare: 0 callout (label beside its point, flips side to stay in view), 1 columns (labels in a column on each side, sorted and spaced, only their height follows, smoothed)
- [x] 4 placeholder labels on the home page; the meta line shows the point's survey coordinates (E / N / ALT)
- [x] Style values in the panel (Legend lines group: layout, ink, opacity, scale (text size; rise, spacing and anchor ring in em of it), line width, anchor ring, rise, diagonal angle, column inset, spacing, follow, lift, fog cutoff, draw time, stagger)
- [ ] Browser check and look tuning (yours)
- [x] `feature/legend-collisions`: callout labels placed nearest first (the current POI's first, with room for its Data button); one that would overlap a placed label rises above it, eased (`follow`, slower during flights: `flightFollow`). Mist floor: labels fade with the mist down to 0.5 at most, never out

### M3b — POI navigation (`feature/poi-navigation`)

Free navigation is replaced by POIs: the camera flies to any POI, and scrolling steps through them in order.

- [x] POIs in `lib/content/pois.ts` (id, title, label point, camera pose: target x/z, distance, heading), visiting order = list order; 4 placeholders
- [x] `camera.flyTo(pose)`: van Wijk & Nuij smooth pan-and-zoom path (backs off with the distance travelled; pitch follows the zoom), heading the shortest way, eased; ground clearance planned once at the start (rest heights along the path capped by smooth parabolas, ends blended to the exact start and landing heights). `camera.jumpTo(pose)` for the first load and reduced motion
- [x] `navigation/tour.ts`: `Tour` (current POI, `go` / `next` / `previous`, module-level so it survives navigation) + `tourControls`: one step per wheel gesture (momentum never skips a POI), vertical swipes, ← → ↑ ↓ Page Up/Down Space Home End
- [x] Turning around the current POI kept for visitors: mouse drag (any button), touch drag across (the first pixels pick turn or swipe), Q / E, with inertia; waits during a flight
- [x] Legend labels are buttons: click flies to that POI, clicking the current one again flies back to the overview (the first POI); the current one is marked (`aria-current`)
- [x] Free camera (pan, zoom, rotate) only in dev, from the panel's new action buttons: "Free camera", "Copy pose" (copies `view: {…}` to paste into `pois.ts`); the compass is now a display
- [x] Panel: Flight group (back-off, pace, min / max time, ease); readout "poi n/N · title · flying"
- [ ] Browser check and flight tuning (yours)

### M3c — Project view (`feature/project-view`)

- [x] `lib/content/projects.ts`: `{ slug (= POI id), title, presentation, credits, media }`, media = images (enhanced-img) and videos (files as they are), by path in `lib/assets/projects/<slug>/`; 2 placeholders from the old lab images (North ridge has no project)
- [x] The scene moved to `routes/(site)/+layout.svelte`, shared by `/` and `/projects/[slug]/` (prerendered with `entries()`, title + description in the head): no reload between them
- [x] ~~Arriving at a POI opens its project~~ → once the camera has arrived at a POI with a project, its label shows a Data button that navigates to the project's URL; the card shows from `page.data.project`. Back, Escape, the × or a click on the scene closes (a history step back when opened from the scene); a project's URL brings the camera to its POI (jump on load, flight on back / forward)
- [x] `ProjectOverlay`: a card over the live scene, centred by default (or left / right), 58rem wide (wind and mist keep moving), scrolling on its own; optional CSS `backdrop-filter` isolation (blur, saturation, brightness, tint) over the scene and labels; first line E / N like the legend; images open in the lightbox; videos muted and looping while visible (not with reduced motion), controls to unmute
- [x] Panel: Project overlay group (scene blur, saturation, brightness, tint + opacity, card colour + opacity, width, fade time)
- [x] Navigation reworked: no more scroll steps. Home and the POIs are reached by the labels and a masthead menu (01 Dig site, 02 …); clicking the current POI's label or Escape goes home, as you left it (zoom and turn remembered). Around the pivot (home's point, or the POI's), drag / ← → / Q E turn and wheel / pinch / ↑ ↓ / + − zoom
- [x] Start view in the panel (pivot x / z, distance, heading; "Use view as start" from the free camera); POI views relative to it (`zoom` × start distance, `turn` + start heading), "Copy pose" writes them so. Outdated Start distance removed; Controls group relabelled
- [ ] Browser check and look tuning (yours); perf of the backdrop blur on the phone (fallback: blur in GL)
- [ ] Real projects: one folder per project in `lib/assets/projects/<id>/` with its `project.md` and media, the POIs placed in Houdini (yours; see M11)

**Done when:** at a POI, Data opens its project as a card over the live scene, the images open in the lightbox, and back returns to the dig site. `build` outputs one HTML per project and `check` passes.

---

## M4 — Deploy (needs Q1)

- [ ] `paths.base` / `web/static/CNAME` according to Q1
- [ ] `.github/workflows/deploy.yml`: triggered on `web/**` + the workflow file; checkout → setup-node (`node-version-file: .nvmrc`, `cache-dependency-path: web/package-lock.json`) → `npm ci` + build in `web/` → `upload-pages-artifact` (`path: web/build`) → `deploy-pages` (`pages: write`, `id-token: write`, `github-pages` environment)
- [ ] Repo Settings → Pages → Source: GitHub Actions
- [ ] 404 page; deep links and refresh on `/projects/<slug>`
- [ ] Size limits: files > 100 MB rejected on push, site ≤ 1 GB, soft bandwidth 100 GB/month

**Done when:** the live URL serves `/` and the project page, with working deep links.

---

## M5 — ~~Splat finds~~

Dropped (2026-10-29): simpler, faster without.

---

## M6 — Real terrain + acceleration

- [ ] Swap the placeholders for the Houdini heightmap and baked maps; tune bounds, fog and grid
- [ ] If the gate needs it: max-height mip pyramid (explicit mip uploads) or cone map (`RG16F`), through the strategy hook

---

## M7 — Transitions polish

- [ ] Navigation through `onNavigate`, the camera move coordinated with the DOM (legend lines drawing in and out); render-to-texture via `gl/targets.ts` if needed
- [ ] `prefers-reduced-motion`: instant transitions, no glides

---

## M8 — Dust (`feature/m8-dust`)

- [x] `drawables/dust/`: stateless points (no simulation buffers: a speck's position is a function of `gl_VertexID` and the time), drawn as a second view on the scene element after the terrain; depth-tested against the ground, premultiplied blend, no depth write
- [x] Carried by the wind (`/wind`, per-speck speed spread), turbulence from the 3D noise texture in the frame of the air, most specks low over the ground (`height()` from `/terrain`), a share skipping along it in hops; glow toward the sun (backlight); fogged with `atmosphere()` per speck
- [x] Box ahead of the camera, anchored in the world and wrapping at its edges (faded there and near the lens), so the density is the same at home and at every POI; under 1.5 px a speck keeps its size and fades by area (no flicker)
- [x] `Terrain.sceneUniforms`: the ground, wind and fog uniforms for later passes
- [x] Panel: Dust group (count, size, opacity, colour, backlight, range, height, wind follow, turbulence, eddy size / speed, hopping share, hop height, largest size, near fade)
- [ ] Browser check and look tuning (yours); count for phones (Q4)
- [ ] Later, if wanted: a dust burst when a project opens; verlet cords

---

## M10 — Light shafts (`feature/god-rays`)

- [x] Shadow ceiling (`drawables/terrain/shadow.frag`): for each ground position, the height under which the air is in the ground's shadow, walking toward the baked sun; R8 over the slab, 512² over twice the heightmap (the far field around it, lit beyond, faded). Rendered once per ground (load, far field change, shader reload)
- [x] In the march (`shafts.glsl`): samples along the part of each view ray inside the slab (denser near the eye, jittered), weighted by the air's density (mist and haze) and what reaches the eye; the lit share goes in the cache's alpha, so a still view pays nothing
- [x] In `/fog`'s `atmosphere(…, lit)`: air in shadow darkens and loses the sun glow, lit air glows toward the sun. Dust and other passes: all lit. (First version acted on the mist only: invisible, the haze is most of the fog)
- [x] Panel: Light shafts group (samples, 0 = off; edge softness; shadow darkness; glow; glow tightness; show shadow volumes, a grey debug view)
- [ ] Browser check and look tuning (yours); moving fps on the phone with and without (samples 0)
- [ ] Later, if wanted: dust darker in the shadow volumes (it could read the shadow ceiling too)

---

## M12 — Legend shadows (`feature/legend-shadows`)

- [x] The legend writes its lines in 3D after each frame (`legend/lines.ts`): diagonal and shelf, unprojected at the anchor's depth (a plane facing the camera: they stand exactly where they're seen), the drawn part only, a pixel's size at that depth
- [x] `drawables/legend-shadows/`: one instanced box per segment, from it along the sun until below the ground, as thick as the line (px); the fragment measures the ray's exact path inside, stops it at the ground (cache depth), and darkens by the sunlight the air there would have scattered (mist and haze density, what reaches the eye, the terrain's shadow ceiling), at three points. Between the terrain and the dust; nothing drawn with no label shown
- [x] Panel: Legend shadows group (strength, 0 = off; thickness in px; longest path counted)
- [ ] Browser check and tuning (yours); phone fps with and without (strength 0)
- [x] The shadow on the ground: where a ray meets the ground inside a box, a thin line, soft across, fading with the fog, none where a ridge already shades the ground (Ground shadow, 0.6)
- [x] The labels' text on the ground: the legend writes each shown label's text box in 3D and its text; the drawable draws the text into a mask atlas (2D canvas, same fonts, redrawn only when a label's text or style changes) and shades the ground where the sun ray from it crossed a letter, blurring with the distance (Text on the ground 0.6, Text softness). Ground only for now: in the god rays it would cost much more (wide boxes, samples)
- [ ] Phone fps with and without the text (Text on the ground at 0)

---

## M11 — Content pipeline (`feature/content-pipeline`)

- [x] `lib/assets/terrain/pois.json`: where the POIs stand (id, x, z, menu order), exported from Houdini by `hou/snippets/export_pois.py` (one point per POI, `s@name` = id). Contract: [formats/pois.md](formats/pois.md)
- [x] `lib/assets/projects/<id>/project.md`: title, framing (`view`, from "Copy pose"), credits, media list in a YAML header, the paragraphs under it; media files beside it, a video's poster by name. Contract: [formats/projects.md](formats/projects.md)
- [x] Read at build time (`vite.config.ts`, `yaml` package, nothing shipped), checked in `content/pois.ts` and `content/projects.ts` with messages naming the file. A POI without a folder gets a label from its id; a folder without a POI is left out (console warnings). No text and no media: no card
- [x] The four placeholders moved to the new files
- [x] `lib/assets/portfolio.yaml`: your name and the home description ([formats/portfolio.md](formats/portfolio.md)). No names left in the code
- [x] Sites (POIs grouped by discipline, one menu each; commit 4c136d5), then dropped for now: one list, a Projects button on phones (see Q7)
- [ ] First real export from Houdini with the real heightmap (M6), yours

---

## M9 — Polish & robustness

- [ ] No-WebGL2 fallback: DOM grid of project links over a static image
- [ ] Full context-loss recovery (rebuild programs, textures, buffers)
- [ ] Phone perf pass (`feature/perf-mobile`, phone at 30 fps before):
  - [x] Mist banks from the 3D noise texture instead of hashed value noise (every pixel and every dust speck, every frame)
  - [x] Dynamic resolution in the renderer (pixel ratio steps down when frames run long, back up when they keep up; Renderer group: adaptive, lowest scale; "q" in the stats)
  - [x] Legend smaller on phones (Phone scale, under 700 px wide)
  - [x] POI menu folded on phones (`feature/phone-menu`): a Projects button unfolds the list; an entry, a tap outside (which does nothing else) or Escape folds it
  - [x] First check: 90 fps still, down to 30 moving (the march). Adaptive resolution now aims at 60 fps, not the display's 90 / 120 Hz; the march runs at lower resolution while the camera moves (March: motion scale 0.5), then sharp once it has been still 0.15 s
  - [ ] Second phone check (fps moving, q reached); then march steps or dust count for phones if needed
  - [x] Q6: rough march in motion only where moving frames run long (`feature/adaptive-march`). When frames run under ~52 fps, the renderer asks the drawables to get cheaper first (`Drawable.degrade()`): the terrain switches to the rough march in motion if the slow frames were moving ones, once for all (remembered on the device in browser storage); only then does the resolution drop. Long frames in a row count (a slow device), a lone one is a hitch and doesn't; the first 2 s don't. March → Rough in motion: 0 never, 1 automatic, 2 always; the stats show "motion sharp / rough"
  - [ ] Check on the phone that it switches by itself ("motion rough" after the first moves) and that the desktop stays sharp
- [ ] `prefers-reduced-motion`, keyboard/focus, meta/OG tags, page titles
- [ ] Lighthouse pass (LCP with a full-screen canvas, CLS)

---

## Decision log

- **2026-10-29**: Legend shadows in the god rays with the legend unchanged (no 3D stakes, which would have changed its look): the lines are placed in 3D facing the camera at their point's depth, so their shadows follow what you see, and turn with you when you orbit. Drawn every frame as geometry over the terrain (the lines move with the labels), not in the cached march.
- **2026-10-29**: No sites for now: about 10 POIs at most, so one list is enough, and content comes first. The phone menu folds behind a Projects button. The sites version stays in the history (commit 4c136d5), with the site-labels idea in Q7.
- **2026-10-29**: Q7, sites: groups of POIs by discipline in the one landscape, one menu each. The site is written on each POI in Houdini as its heading reads (`s@site = "VFX"`), not listed anywhere else (a first version listed ids and headings in `portfolio.yaml`: duplicated, dropped). `portfolio.yaml` holds your name and the home description, so no name is written in the code. "Dig site" is gone as a name (it stays the scene's metaphor). A scene per site stays possible later: every POI already carries its site.
- **2026-10-29**: Content pipeline: where a POI stands comes from Houdini (`pois.json`, positions only), what it shows from its project folder (`project.md` + media), matched by id, so a re-export never overwrites text or framing. Framing stays tuned in the web (Copy pose), since the site's camera ties its tilt to its distance and a Houdini camera can't be matched. YAML for `project.md`'s header (nicer than JSON to write by hand), parsed at build time. Houdini only, no Blender exporter.
- **2026-10-29**: Sites: the POIs belong to a site (Dig site, `site` in `content/pois.ts`) whose name heads their menu (on phones, the button that unfolds it). More sites to come, by topic (Q7).
- **2026-10-29**: The first POI is a POI like the others (a project page too), not home. Home is the overview framed by the start view, where no POI is current: every label rearranges alike there. Escape, the current POI's label and the Home key go back to it. The POI was "Dig site" at the origin, confusing with the scene's own name: renamed Test pit (`test-pit`) and moved to the hollow north-east of the plateau.
- **2026-10-29**: Q6: the rough march in motion becomes automatic. Desktops march sharp while moving; a device whose moving frames run under ~52 fps switches to rough by itself, remembered for its next visits. It goes before dynamic resolution: the renderer asks the drawables to get cheaper (`degrade()`) before lowering the pixel ratio, so a slow phone loses sharpness in motion only, not resolution everywhere.
- **2026-10-29**: God rays as light shafts in the mist (the ridges' shadow volumes), not a screen-space blur toward the sun: the camera looks down and the sun is low, so it is almost never on screen. The sun and the ground being fixed, the shadow volumes come from a shadow ceiling rendered once, and the shafts are computed in the march and cached with the ground: no per-frame cost when still. They match the baked shadows (same sun, same ground).
- **2026-10-29**: The site stays local for now; deploy (M4) when you decide.
- **2026-10-29**: Legend: labels no longer vanish in the mist (they fade to a floor, 0.5 by default), and in the callout layout they rise out of each other's way, nearest first. They keep sorting themselves out during a flight (it reads as the survey reorganising), just slower (Follow in flight 1, vs 5 at home); freezing them in flight was considered and isn't needed.
- **2026-10-29**: Q4: the reference device is your old, cheap phone (90 Hz screen), the weakest one to support; the target is 60 fps. The march runs rough while the camera moves and sharp once it settles.
- **2026-10-29**: Phone performance: dynamic resolution instead of per-device settings (the pixel ratio follows the frame time, judged against the display refresh), and the mist banks moved to the noise texture. Measure on the phone before touching the dust count or the march.
- **2026-10-29**: Dust as stateless particles (position from id + time, computed in the vertex shader) instead of a transform-feedback simulation: no buffers, nothing to rebuild on context loss, any count change is free. Specks drift with the wind and turbulence and skip along the ground in hops; real collisions and bursts would need the stateful version, not needed for ambient dust.
- **2026-10-29**: After the first try of the overlay: no ordered path through the POIs any more. Home is the hub; labels and a menu fly to any POI, Escape or the current label goes home as you left it. The wheel zooms again, toward the pivot (home's point or the POI's), and drag turns. The project opens from a Data button on the arrived POI's label, not by itself, as a card over the live scene (light isolation by default). POI views are relative to a start view tuned in the panel, so retuning its heading carries every POI.
- **2026-10-29**: Project view: it opens at the end of the camera flight, with no button, however the POI was reached (label, scroll, keys). Real prerendered URLs (`/projects/<slug>/`); the scene lives in a `(site)` layout shared with `/`, so it never reloads. Isolation by CSS `backdrop-filter` over the scene and the labels, tuned live; blur in GL only if the weak device struggles. Content: title, a few lines of presentation, credits, then images and short videos (5–60 s, Instagram-like), self-hosted MP4 played muted while visible.
- **2026-10-29**: Navigation by POIs instead of free controls: the camera flies to any POI (procedural, planned flight), and scrolling / arrows / swipes step through them in a curated order; teleport only under reduced motion. Free pan / zoom / rotate stays as a dev tool to frame the POI poses (Copy pose); visitors keep turning the view around the current POI. The project view will be an HTML layer over the scene with isolation (desaturation, blur), opened from a POI; dust particles stay on the list (M8).
- **2026-10-29**: The core sample is dropped (content inside a hard-to-read object didn't work), and so are the splat finds: simpler, faster, nicer. The 3D stays the misty landscape; information is elegant HTML text over it, tied to places in the scene by legend lines (anchor in 3D, stable label, one elbow). Project view still being planned: a survey mode in a digital datavis style is the leading direction. The canvas outliving navigation makes real prerendered project pages possible without shallow routing. Kept from the core: the lightbox carousel, the noise textures, the homography helper.
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
