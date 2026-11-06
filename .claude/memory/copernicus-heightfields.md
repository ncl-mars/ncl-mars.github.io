---
name: copernicus-heightfields
description: Houdini 22's Copernicus has the heightfield suite (Erode, Slump, Mask by Feature, Strata...); any layer named height works; SOPs only for the export snippets
metadata:
  type: feedback
---

Houdini 22's Copernicus has almost all the heightfield tools: HeightField Erode (Feature Size; `erodability`, `rainfall` inputs; `debris`, `sediment`, `flow` outputs), Slump (a `debris` layer down to a Repose Angle, can add it to the height), Mask by Feature (slope, height, curvature, direction, occlusion), Strata, Terrace, Clip, Project, Transform 2D/3D, Visualize. No heightfield object is needed: any layer named `height` works, preferably with its layer type info set to height so it displays as a heightfield. Docs: `$HFS/houdini/help/nodes.zip`, `cop/heightfield_*.txt`.

**Why:** on 2026-11-06 I suggested SOP HeightField Erode "outside your Copernicus workflow"; the user: "NO, GO FETCH, ALMOST ALL HEIGHFIELD OBJECTS ARE NOW AVAILABLE IN COPERNICUS ! ... so no more sop context, just to export with the python snippets".

**How to apply:** for terrain work, look for a built-in COP heightfield node before proposing a kernel, and never route through SOPs except to export. Related: [[copernicus-image-ops]], [[cop-opencl]].
