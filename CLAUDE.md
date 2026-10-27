# CLAUDE.md

Personal portfolio: a SvelteKit static site with a raw WebGL2 renderer, hosted on GitHub Pages, plus the Houdini pipeline that produces its assets.

## Working rules

- Write code only inside this folder. Nothing outside it without the user's agreement: no temp files, no global memory, no installs.
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

## Commands

Run from `web/` (in Bash: `cd web && …`). The default Node is 22.12.0 and **must not be changed** (Mont-Blanc pins it). That's why this is SvelteKit 2, not 3 (see `doc/stack.md`).

- `npm run dev`: dev server with hot reload
- `npm run build`: static site to `web/build/`
- `npm run check`: type check (`svelte-check`). This is the only static check: no linter, no tests.

Smoke-testing the dev server on Windows: stopping the background `npx vite dev` leaves its `node` child listening. Kill the process that owns the port afterwards (PowerShell `Get-NetTCPConnection -LocalPort <port>` → `Stop-Process`).
