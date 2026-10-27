# Python SOP: exports the heightfield's `height` volume for the web terrain.
# Format: doc/formats/heightmap.md -> heightmap.bin (little-endian half floats, normalized 0..1) + heightmap.json.
# Tracking copy: the node snippet in the .hip is canonical.
#
# Pass-through (the geometry isn't modified). It writes on every cook: bypass the node when not exporting.
# Expects a heightfield lying in XZ (no rotation); axis flips and swaps are handled below.

import json
import os

import hou
import numpy as np

OUT_DIR = hou.text.expandString("$HIP/../web/src/lib/assets/terrain")

geo = hou.pwd().geometry()
volume = next(
    (p for p in geo.prims() if isinstance(p, hou.Volume) and p.attribValue("name") == "height"),
    None,
)
if volume is None:
    raise hou.NodeError("No 'height' volume in the input")

rx, ry, rz = volume.resolution()
data = np.array(volume.allVoxels(), dtype=np.float32).reshape(ry, rx)  # [j][i], i varies fastest

# Which voxel axis runs along world X and Z, and in which direction
origin = np.array(volume.indexToPos((0, 0, 0)))
di = np.array(volume.indexToPos((1, 0, 0))) - origin
dj = np.array(volume.indexToPos((0, 1, 0))) - origin
if abs(di[0]) >= abs(di[2]):
    grid, x_step, z_step = data, di[0], dj[2]  # rows follow Z (j), columns follow X (i)
else:
    grid, x_step, z_step = data.T, dj[0], di[2]  # swapped axes
if x_step < 0:
    grid = grid[:, ::-1]
if z_step < 0:
    grid = grid[::-1, :]
# Now row 0 = min Z and column 0 = min X: index = j * width + i, i -> +X, j -> +Z

heights = grid + origin[1]  # heightfield values are offsets from the volume's plane
lo, hi = float(heights.min()), float(heights.max())
normalized = (heights - lo) / max(hi - lo, 1e-6)

bbox = volume.boundingBox()  # outer edges of the voxels, as the format expects
meta = {
    "version": 1,
    "width": int(grid.shape[1]),
    "height": int(grid.shape[0]),
    "format": "r16f",
    "bounds": {
        "min": [bbox.minvec()[0], lo, bbox.minvec()[2]],
        "max": [bbox.maxvec()[0], hi, bbox.maxvec()[2]],
    },
}

os.makedirs(OUT_DIR, exist_ok=True)
np.ascontiguousarray(normalized).astype("<f2").tofile(os.path.join(OUT_DIR, "heightmap.bin"))
with open(os.path.join(OUT_DIR, "heightmap.json"), "w") as f:
    json.dump(meta, f, indent="\t")
