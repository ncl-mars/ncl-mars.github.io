---
name: materials-dormant
description: The terrain's look comes from the albedo maps; the materials.png code stays in the shader unused, maybe removed later
metadata:
  type: project
---

Since 2026-11-04 the ground's look comes from `albedo.png` (LINZ aerial photos, de-lit with `delight.cl`) and `faralbedo.png` (satellite mosaic); no `materials.png` is exported. The material code (masks, the gradient blend in `shade.glsl`) stays, dormant: without the file the ground is matte and the material shading is skipped.

**Why:** the user found the albedo enough for the look; materials may come back if a stamp needs reflections.

**How to apply:** don't build on materials or suggest them for the look. If the shader needs slimming, removing the material code (or skipping its arithmetic without a file) is an option the user already has in mind.
