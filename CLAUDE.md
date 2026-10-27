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
- State that must survive navigation (the home camera, the terrain drawable) lives in the page's `<script module>`.
- Views are expected in normal document flow: rects are cached in document space, so a `position: fixed` view on a scrolling page would drift.
- Shader hot reload: each drawable module ends with `import.meta.hot.accept([...shader paths], …)` calling `hotSwap()`. Copy the block from `drawables/test/TestPattern.ts`, using relative paths.
- Never read layout in the frame loop. Rects are cached in document space; visibility is arithmetic.
- `/lab/views/` is the view-system test page. The dev perf HUD toggles with P.

## Commands

Run from `web/` (in Bash: `cd web && …`). The default Node is 22.12.0 and **must not be changed** (Mont-Blanc pins it). That's why this is SvelteKit 2, not 3 (see `doc/stack.md`).

- `npm run dev`: dev server with hot reload
- `npm run build`: static site to `web/build/`
- `npm run check`: type check (`svelte-check`). This is the only static check: no linter, no tests.
- `npm run gen:terrain`: placeholder heightmap + maps into `src/lib/assets/terrain/` (refuses to overwrite without `-- --force`, the files may be a real Houdini export)

Smoke-testing the dev server on Windows: stopping the background `npx vite dev` leaves its `node` child listening. Kill the process that owns the port afterwards (PowerShell `Get-NetTCPConnection -LocalPort <port>` → `Stop-Process`).
