---
name: baked-lighting
description: Terrain shadows stay baked in Houdini and the sun fixed; only the sun's angle on the slope (n·L) is computed in the shader
metadata:
  type: project
---

The terrain's shadows, AO and cavity come from the Houdini bake (`maps.png`; R is the sun's cast shadow alone since `maps.json` version 2, 2026-11-01), and the sun is the bake's (`maps.json` sunDir). The shader computes only the sun's angle on the slope (n·L) from the heightmap's normal, so 2K heights light at their own resolution over 1K maps. A live sun with marched shadows was built and reverted on 2026-10-29.

**Why:** asked for "sun rotation settings", they only meant the start view should face the sun; live lighting was "a bad idea, we need baked shadow". The n·L split was the user's call ("let's bake only the shadows"), over exporting a 2K normal map.

**How to apply:** to change where the sun appears, aim the camera (start view, POI views), or the user re-bakes (a new `sun_dir` on the bake kernel, then re-export). Ask what a lighting request means before touching the shading model. Relates to [[portfolio-scope-web-only]].
