---
name: copernicus-image-ops
description: Image operations on terrain layers (masks, blurs, remaps) are the user's, in Copernicus; Houdini export scripts only read, check and pack layers
metadata:
  type: feedback
---

Image work on the terrain layers (material masks, masks from an index, blurs, remaps) is done by the user in Copernicus. The Python export snippets (`hou/snippets/export_*.py`) only read the layers, check them (resolution, footprint) and pack them into files.

**Why:** when Claude suggested the exporter could build the material masks from `material_index` with numpy, the user answered "masks IN COPERNICUS, MYSELF. never this kind of op in python scripts" (2026-11-01).

**How to apply:** never propose or write image processing in the export scripts; say what a layer must contain and let the user build it. `export_maps.py` still dithers when rounding to 8 bits (`DITHER`): flagged to the user, no answer yet. Relates to [[portfolio-scope-web-only]], [[user-profile]].
