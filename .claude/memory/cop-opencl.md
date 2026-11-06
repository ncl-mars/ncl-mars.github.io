---
name: cop-opencl
description: Copernicus OpenCL facts checked in Houdini 22: imx.h API, ID layers, Mono to SDF sign and units, jumping to an SDF's outline
metadata:
  type: reference
---

- The @-binding API is listed in `$HFS/houdini/ocl/include/imx.h` (comments near line 150): `@P` (image space), `@dPdx` / `@dPdy` (one pixel), `@name.xres`, `bufferIndex(int2)`, `bufferSample` (nearest for int layers), `imageSample`, `imageNearest`, `dCdx` / `dCdy` (not for int), `set`, `setIndex`.
- ID layers bind as `int` (`#bind layer project_id int`) and read with `imageNearest`.
- Image space spans -1..1 across a square layer's width, so one pixel is `2.0f / @name.xres` (as in `delight.cl`).
- Mono to SDF: negative inside (above the iso), positive outside. Distances are in image units, like `@P`: checked 2026-11-06, jumping `P - n * d` lands on the outlines.
- Jumping to an SDF's outline (the id map kernel `extrapolate_ids`: each pixel takes the nearest stamp's id, 0 is the ground):
  - Repeat `p -= n * (d + inset)`. A single jump misses far away, because the direction error grows with the distance.
  - Pixels on ridges, where the central difference cancels out, need many iterations: the user raised the count until the speckles went.
  - Thin lines of a third id along some territory borders remain. Only one-sided differences would fix them.

Related: [[houdini-snippets]], [[copernicus-image-ops]].
