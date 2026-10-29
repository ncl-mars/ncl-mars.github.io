# CLAUDE.md

Personal portfolio: a SvelteKit static site with a raw WebGL2 renderer, hosted on GitHub Pages, plus the Houdini pipeline that produces its assets.

## Working rules

- Write code only inside this folder. Nothing outside it without the user's agreement: no temp files, no global memory, no installs. Scratch files go in `.tmp/` (gitignored), never `/tmp` or the system temp folder.
- Don't touch files the user is tuning live without asking.
- The user runs all git commands. Suggest commit messages, and never add a `Co-Authored-By` or any other attribution line.
- Answer planning questions in chat. Edit docs only when asked, or to keep the roadmap's decision log current.

## Memory

Notes live in `.claude/memory/`, **not** in the global `~/.claude/projects/.../memory/` folder. Save new notes there, one fact per file, and add a line to the index:

@.claude/memory/MEMORY.md

## Docs

- `doc/roadmap.md`: order of work, open questions, decision log
- `doc/stack.md`: web stack and its rules
- `doc/home-concept.md`: home page design (the dig site)
- `doc/project-structure.md`: folder layout
- `doc/formats/`: binary format contracts (heightmap, terrain maps)

## Layout

- `web/`: the SvelteKit app (the only thing that gets built and deployed)
- `hou/`: Houdini ($JOB). `doc/`: docs. Details in `doc/project-structure.md`.

## Renderer (`web/src/lib/gl/`)

- One canvas, owned by `routes/+layout.svelte`. Pages get the renderer with `getRenderer()` and register DOM elements with `{@attach renderer.view(drawable)}`. Never create another canvas.
- Drawables (`lib/drawables/<name>/`) implement `init` / `update` / `draw` / `dispose` (`lib/gl/types.ts`). Constructors must not touch the DOM or GL (prerender runs in Node). Create GL resources in `init`.
- Programs come from `renderer.program(vs, fs)`, cached by source for the life of the context. Textures and other per-context resources go through `renderer.resource(key, create)`, cached the same way.
- State that must survive navigation (the home camera, the tour, the terrain drawable) lives in the `<script module>` of `routes/(site)/+layout.svelte`. That layout draws the scene for `/` and `/projects/<slug>/`, so it stays mounted between them.
- Navigation is by POIs (`lib/content/pois.ts`). The first is home, framed by the start view (tuning group `start`, its pivot being home's point); the other POI views are relative to it (`zoom` × start distance, `turn` + start heading). `navigation/tour.ts` flies to any POI (labels, the masthead menu; `camera.flyTo(pose)`, clearance planned up front), remembers home as you left it, and its controls only turn and zoom around the current pivot (drag, wheel, pinch, keys; not during a flight). The free controls (`gl/controls.ts`) are a dev tool, switched on from the panel ("Free camera", then "Copy pose" for a POI view or "Use view as start"). Dev panel buttons come from the `actions` map in `lib/tuning`.
- Projects (`lib/content/projects.ts`, one per POI with the same id; media in `lib/assets/projects/<slug>/`, images through enhanced-img, videos as files): once the camera has arrived at a POI with a project (`tour.onArrive`), its label shows a Data button, which navigates to `/projects/<slug>/` (prerendered with `entries()`); the `(site)` layout shows `components/ProjectOverlay.svelte`, a card over the live scene, from `page.data.project`. The URL is the truth: back closes the card, a project's URL brings the camera to its POI. Isolation is a CSS `backdrop-filter` over the scene and labels (tuning group `overlay`); the card scrolls on its own.
- The terrain draws in two passes: the march (`terrain.frag`) into a cache, only when `camera.revision` or a ground setting changes; and the composite (`composite.frag`), every frame, with the atmosphere from `chunks/fog.glsl`. Anything drawn later in the scene includes `/noise`, `/wind`, `/fog` and uses `atmosphere()`, so it sits in the same mist.
- Smooth noise in shaders: prefer the noise textures from `gl/noise.ts` (`renderer.resource('noise:3d' | 'noise:hash', …)`: tileable 3D gradient noise, 4 channels, sample with `p / 8`; hash for per-cell random values) over hashed value noise, which looks blocky at fine scale. `sampler3D` has no default precision in fragment shaders: declare it `highp`. The value noise in `/noise` stays for the terrain's far field, which the CPU mirrors.
- Shader chunks don't include each other: each shader includes what it needs, in order (`/common`, `/noise`, `/terrain`, `/wind`, `/fog`). Fragment shaders that use `/noise` declare `precision highp int`.
- The ground exists twice and must stay identical: `lib/gl/chunks/terrain.glsl` (GPU) and `lib/terrain/farfield.ts` + `ground.ts` (CPU: camera following, picking). Change both together. CPU code samples the ground through `Ground`, never the raw `Heightfield`.
- Views are expected in normal document flow: rects are cached in document space, so a `position: fixed` view on a scrolling page would drift.
- Shader hot reload: each drawable module ends with `import.meta.hot.accept([...shader paths], …)` calling `hotSwap()`. Copy the block from `drawables/test/TestPattern.ts`, using relative paths.
- Never read layout in the frame loop. Rects are cached in document space; visibility is arithmetic.
- DOM overlays that follow the scene (compass, labels) update from `renderer.onFrame(cb)`, which runs after each rendered frame. Write `el.style` / attributes directly, only when the value changed, never through Svelte state.
- Legend lines (`components/Legend.svelte` + `legend/legend.ts`): HTML labels tied to ground points by SVG hairlines. Put the component inside the view element (it fills it). Label sizes come from a ResizeObserver. Labels fade with the mist through `terrain/atmosphere.ts`, a CPU mirror of `fog.glsl` (distance fog + mist, no banks): change both together.
- `/lab/views/` is the view-system test page.
- HTML that must sit on a 3D quad in perspective: `gl/homography.ts` gives the CSS `matrix3d`, updated in `renderer.onFrame()`.
- Meshes with vertex attributes use explicit `layout(location = 0)` so VAOs survive shader hot reload.
- Pages whose content scrolls over a fixed GL view scroll an inner fixed container, never the window, so the view's cached rect stays valid.

## Tuning (`web/src/lib/tuning/`)

- Every tunable value (camera, controls, march, shading, fog, renderer) lives in `defaults.json`. Code reads `tuning.<group>.<key>` live, every frame or event; don't copy the values into locals at construction.
- Adding a value: add it to `defaults.json`, describe it in `schema.ts` (label, range, hint), read it from `tuning`. If changing it needs an action, use `onTuningChange` (e.g. the pixel-ratio cap in the root layout).
- Dev panel (`lib/components/DevPanel.svelte`, dev only, P toggles): stats, live readouts (`readouts` map, registered by pages), and sliders. "Save defaults" writes `defaults.json` through the dev server endpoint `/__tuning/save` (`vite.config.ts`), which checks the shape first. `tuning/index.ts` hot-accepts `defaults.json`, so saving doesn't reload the app.

## Commands

Run from `web/` (in Bash: `cd web && …`). The default Node is 22.12.0 and **must not be changed** (Mont-Blanc pins it). That's why this is SvelteKit 2, not 3 (see `doc/stack.md`).

- `npm run dev`: dev server with hot reload
- `npm run build`: static site to `web/build/`
- `npm run check`: type check (`svelte-check`). This is the only static check: no linter, no tests.
- `npm run gen:terrain`: placeholder heightmap + maps into `src/lib/assets/terrain/` (refuses to overwrite without `-- --force`, the files may be a real Houdini export)

Smoke-testing the dev server on Windows: stopping the background `npx vite dev` leaves its `node` child listening. Kill the process that owns the port afterwards (PowerShell `Get-NetTCPConnection -LocalPort <port>` → `Stop-Process`).
