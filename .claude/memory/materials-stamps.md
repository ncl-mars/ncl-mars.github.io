---
name: materials-stamps
description: Materials removed (2026-11-10): one matte material, the object stamps are sand; don't propose material looks unless the user brings them back
metadata:
  type: project
---

The user set the materials aside on 2026-11-05 (one material, the matte ground, the object stamps sand like it: metal and gloss rendered poorly, a "déchetterie" (dump) look) and had them removed on 2026-11-10: masks and slots in `shade.glsl`, their uniforms and settings, the `materials` tuning group, the optional glob, `export_materials.py`, the docs. The ground is lit by n·L × the baked shadow × AO and cavity, its colour from the albedo maps. The black stand-in texture (`blackTexture()`, resource `'black'`) stays: it serves a missing albedo.

**Why:** the user's call after seeing the metal on the mont-blanc stamp; real reflections (a second march) were offered and judged not worth it. Running empty, the code still cost the march per pixel.

**How to apply:** don't propose material-based looks or fixes (reflections, metal, gloss, slots) unless the user brings materials back; the code is in the git history (87b8a0a and before). If they do: the slots were generic, never call R "gold".
