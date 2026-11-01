# Project structure

```
portfolio/
├─ web/                          SvelteKit app: the only thing CI builds and deploys
│  ├─ src/
│  │  ├─ routes/                 +layout.svelte (owns the canvas), +page.svelte, projects/[slug]/, lab/views
│  │  ├─ lib/
│  │  │  ├─ gl/                  renderer core: renderer, programs, textures, noise, targets, camera, controls, homography, types
│  │  │  │  └─ chunks/           shared GLSL (`#include /name;`): common, noise, terrain, wind, fog
│  │  │  ├─ drawables/           one folder per drawable, its TS and shaders side by side
│  │  │  │  ├─ terrain/          Terrain.ts, terrain.frag (march → cache), composite.frag (atmosphere), surface/march/shade.glsl
│  │  │  │  └─ particles/        later
│  │  │  ├─ terrain/             CPU side of the terrain: heightfield (load, sample), far field (mirror of terrain.glsl), ground (heights + raycast), asset imports
│  │  │  ├─ tuning/              defaults.json (every tunable value), schema.ts (dev panel layout)
│  │  │  ├─ components/          Svelte UI: DevPanel, Lightbox
│  │  │  ├─ content/             reads and checks the content: portfolio.ts, pois.ts (pois.json + framing, sites), projects.ts (project folders)
│  │  │  └─ assets/              pipeline exports + content (imported → hashed URLs)
│  │  │     ├─ portfolio.yaml    your name, the home description
│  │  │     ├─ terrain/          heightmap.bin/.json, maps.png/.json, pois.json (Houdini exports)
│  │  │     └─ projects/<id>/    project.md (title, framing, credits, media list, text) + its images and videos
│  │  ├─ app.html
│  │  ├─ app.d.ts
│  │  └─ ambient.d.ts            module types: shaders, texture imports
│  ├─ static/                    only files that need a fixed URL: favicon, robots.txt, CNAME
│  ├─ scripts/                   npm scripts: gen-terrain.mjs, lib/encode.mjs (PNG + half floats)
│  └─ package.json, svelte.config.js, vite.config.ts, tsconfig.json
├─ hou/                          Houdini ($JOB)
│  ├─ *.hip*, hda/               tracked
│  ├─ snippets/                  tracking copies of node code (the .hip is canonical)
│  │  ├─ python/                 Python SOPs: the exporters
│  │  ├─ ocl/                    OpenCL kernels
│  │  └─ vex/                    wrangles
│  └─ backup/ geo/ cache/ render/   gitignored
├─ tools/                        standalone pipeline scripts, added when needed
├─ doc/
│  ├─ roadmap.md
│  ├─ project-structure.md
│  └─ formats/                   heightmap.md, terrain-maps.md, pois.md: layouts shared by exporters and loaders; projects.md, portfolio.md: the content files
├─ .github/workflows/deploy.yml
├─ .claude/memory/               Claude's project notes (tracked)
├─ .vscode/                      terminals open in web/; Houdini caches excluded from watch/search
├─ CLAUDE.md
└─ .gitignore, .gitattributes, .nvmrc
```

## Rules

- **The app lives in `web/`.** npm commands run from `web/`. CI builds only that folder, with a path filter (`web/**` + the workflow file), so committing a `.hip` doesn't redeploy. Vite never watches the Houdini caches.
- **Pipeline exports go into `web/src/lib/assets/<feature>/`.** Code imports them: `.bin` with `?url`, `.json` directly. That gives hashed URLs, and the base path is handled automatically.
- **`static/` is only for files that need a fixed URL.**
- **`doc/formats/` is the contract.** Each binary format has one spec, and the exporter and the web loader both follow it.
- **Other DCCs** get their own top-level folder (`blender/`, `substance/`…) and follow the same tracked/ignored split as `hou/`.
- **Git:** `.gitattributes` marks every binary as `binary` (`*.bin *.hip* *.hda *.bgeo* *.exr` + images), so Windows line-ending conversion can never corrupt an export. Caches and heavy raw inputs stay out of git. Exported web assets stay small (≲ 20 MB each; GitHub rejects pushes with files over 100 MB).
