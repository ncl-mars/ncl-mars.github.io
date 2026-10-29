---
name: baked-lighting
description: Terrain light and shadows stay baked in Houdini; don't replace them with live lighting
metadata:
  type: project
---

The terrain's direct light and shadows come from the Houdini bake (maps R channel, `maps.json` sunDir). The user wants baked shadows; a live sun with marched shadows was built and reverted on 2026-10-29.

**Why:** asked for "sun rotation settings", they only meant the start view should face the sun; live lighting was "a bad idea, we need baked shadow".

**How to apply:** to change where the sun appears, aim the camera (POI headings in `content/pois.ts`), or the user re-bakes. Ask what a lighting request means before touching the shading model. Relates to [[portfolio-scope-web-only]].
