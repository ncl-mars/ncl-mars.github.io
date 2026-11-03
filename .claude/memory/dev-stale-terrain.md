---
name: dev-stale-terrain
description: After a Houdini re-export with the dev server running, the open page can keep the old heights; hard reload before diagnosing terrain oddities
metadata:
  type: project
---

After re-exporting `heightmap.bin`/`farmap.bin` while `npm run dev` runs, the open page can draw stale heights: `loadHeightfield` (`web/src/lib/terrain/heightfield.ts`) caches by URL, and dev `?url` imports keep the same URL, so hot reload may mix the old samples with the new `.json` bounds.

**Why:** on 2026-11-03 the user saw a height offset between the new 2 km site and the far map. The exports matched to 0.14 m (checked by decoding both); a hard reload fixed it.

**How to apply:** when the user reports a terrain oddity right after an export, first ask for a hard reload (Ctrl+F5) or a dev server restart, then compare the decoded exports, before suspecting Copernicus or the shaders. A loader fix (reload heights when an export changes) was offered, not made yet. Relates to [[diagnose-first]].
