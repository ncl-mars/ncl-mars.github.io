---
name: materials-stamps
description: Materials set aside (2026-11-05): one matte material, the object stamps are sand; the material code stays until the user decides to remove it
metadata:
  type: project
---

On 2026-11-05 the user set the materials aside: one material, the matte ground, and the object stamps are sand like it. Metal and gloss rendered poorly, a "déchetterie" (dump) look. `material_id` is 0 everywhere in Houdini, so `materials.png` is black. The material code stays for now: generic slots R metal, G gloss, B spare, coloured by `albedo.png` times a tint, blended by the masks (`shade.glsl`, the `materials` tuning group, Debug view 3, `export_materials.py` reading one RGB layer).

**Why:** the user's call after seeing the metal on the mont-blanc stamp; real reflections (a second march) were offered and judged not worth it. Earlier that day they insisted the slots are generic: never call R "gold"; gloss is G mixed with the terrain, never Spare.

**How to apply:** don't propose material-based looks or fixes (reflections, slot tuning) unless the user brings materials back. The removal is planned "in a bit": asked for, then paused the same day ("we never know"), so do it only when they say so. Then the whole chain: shader, `Terrain.ts` uniforms and settings type, the optional glob in `terrain/assets.ts`, the schema and defaults group, `'materials'` in the (site) layout's cached-groups list, Debug view 3 (its hint, composite.frag's comment), `export_materials.py` and `materials.png`, the docs and CLAUDE.md. Keep a black stand-in texture: `blackTexture()` also stands in for missing albedo maps. The march's `uFogColor`, `uSkyColor`, `uSunColor`, `uSunGlow` serve only `environment()` and the highlight.
