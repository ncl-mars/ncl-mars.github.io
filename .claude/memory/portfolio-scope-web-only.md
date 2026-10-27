---
name: portfolio-scope-web-only
description: Stick to the web/WebGL2 shader side; don't research or explain Houdini or splat content creation
metadata:
  type: feedback
---

Keep answers and plans on the web rendering side: shaders, renderer, loading, perf. The user knows the Houdini side (Houdini 22) and already knows how to make Gaussian splats and other assets.

**Why:** When I started looking up Houdini splat support while answering "are Gaussian splats easy to use?", the user stopped it: "I know how to make splat! THIS IS NOT WHAT WE ARE DOING HERE! WE ARE DOING WEB SHADERS".

**How to apply:** Treat Houdini as an export source that hands the web side a file format (see `doc/formats/`). Only cover the Houdini side when asked (e.g. the heightmap export Python SOP). See [[user-profile]].
