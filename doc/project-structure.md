# Project structure

```
portfolio/
├─ web/                          SvelteKit app: the only thing CI builds and deploys
│  ├─ src/
│  │  ├─ routes/                 +layout.svelte (owns the canvas), +page.svelte, projects/[slug]/, lab/
│  │  ├─ lib/
│  │  │  ├─ gl/                  renderer core: renderer, programs, textures, camera, controls, types
│  │  │  │  └─ chunks/           shared GLSL (`#include /name;`): noise, wind, fog, height, common
│  │  │  ├─ drawables/           one folder per drawable, its TS and shaders side by side
│  │  │  │  ├─ terrain/          Terrain.ts, terrain.frag, surface/march/shade.glsl
│  │  │  │  ├─ image/
│  │  │  │  ├─ splat/            later, includes sort.worker.ts
│  │  │  │  └─ particles/        later
│  │  │  ├─ terrain/             CPU side of the terrain: heightfield (load, sample), asset imports
│  │  │  ├─ components/          Svelte UI
│  │  │  ├─ content/             projects.ts
│  │  │  └─ assets/              pipeline exports + project images (imported → hashed URLs)
│  │  │     ├─ terrain/          heightmap.bin/.json, maps.png/.json
│  │  │     ├─ splats/
│  │  │     └─ projects/<slug>/
│  │  ├─ app.html
│  │  ├─ app.d.ts
│  │  └─ ambient.d.ts            module types: shaders, texture imports
│  ├─ static/                    only files that need a fixed URL: favicon, robots.txt, CNAME
│  ├─ scripts/                   npm scripts (gen-terrain.mjs: placeholder heightmap + maps)
│  └─ package.json, svelte.config.js, vite.config.ts, tsconfig.json
├─ hou/                          Houdini ($JOB)
│  ├─ *.hip*, hda/               tracked
│  ├─ snippets/                  tracking copies of node code (the .hip is canonical)
│  └─ backup/ geo/ cache/ render/   gitignored
├─ tools/                        standalone pipeline scripts, added when needed
├─ doc/
│  ├─ roadmap.md
│  ├─ project-structure.md
│  └─ formats/                   heightmap.md, splat.md: binary layouts shared by exporters and loaders
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
- **Git:** `.gitattributes` marks every binary as `binary` (`*.bin *.hip* *.hda *.bgeo* *.exr *.ply *.spz` + images), so Windows line-ending conversion can never corrupt an export. Caches and heavy raw inputs stay out of git. Exported web assets stay small (≲ 20 MB each; GitHub rejects pushes with files over 100 MB).
