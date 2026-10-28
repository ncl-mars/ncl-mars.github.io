# Python SOP: exports a depth map as a relief map for the web core viewer.
# Format: doc/formats/relief.md -> <NAME>.relief.bin (little-endian half floats, normalized 0..1,
# 1 = closest to the viewer, row 0 = top of the image) + <NAME>.relief.json.
# Tracking copy: the node snippet in the .hip is canonical.
#
# Input: a 2D volume (resolution width x height x 1), e.g. a HeightField File loading the depth map
# (it lands in the "height" layer), or a render's depth pass. Pass-through (the geometry isn't modified).
# It writes on every cook: bypass the node when not exporting.
#
# Check once with an asymmetric image: if the relief comes out upside down in the browser, set FLIP_ROWS.

import json
import math
import os

import hou
import numpy as np

NAME = "image-1"  # base name, the same as the colour image's (image-1.png -> image-1.relief.*)
OUT_DIR = hou.text.expandString("$HIP/../web/src/lib/assets/lab/core")
VOLUME = "height"  # name of the volume to export
INVERT = False  # True for depth / distance passes where far = high (ML disparity is already near = high)
MAX_SIZE = 512  # longest side after downsampling (box filter); 0 keeps the full resolution
FLIP_ROWS = False

geo = hou.pwd().geometry()
volume = next(
    (p for p in geo.prims() if isinstance(p, hou.Volume) and p.attribValue("name") == VOLUME),
    None,
)
if volume is None:
    raise hou.NodeError("No '%s' volume in the input" % VOLUME)

rx, ry, rz = volume.resolution()
data = np.array(volume.allVoxels(), dtype=np.float32).reshape(ry, rx)  # [j][i], i varies fastest

# Rows from min Z to max Z, columns from min X to max X: a heightfield shows the image upright in the
# top view (top of the image at -Z), so row 0 is the top of the image
origin = np.array(volume.indexToPos((0, 0, 0)))
di = np.array(volume.indexToPos((1, 0, 0))) - origin
dj = np.array(volume.indexToPos((0, 1, 0))) - origin
if abs(di[0]) >= abs(di[2]):
    grid, x_step, z_step = data, di[0], dj[2]
else:
    grid, x_step, z_step = data.T, dj[0], di[2]
if x_step < 0:
    grid = grid[:, ::-1]
if z_step < 0:
    grid = grid[::-1, :]
if FLIP_ROWS:
    grid = grid[::-1, :]

# Box-filter downsample by an integer factor (crops a few pixels at most: the aspect stays within 1%)
if MAX_SIZE:
    factor = max(1, int(math.ceil(max(grid.shape) / float(MAX_SIZE))))
    if factor > 1:
        h, w = grid.shape[0] // factor, grid.shape[1] // factor
        grid = grid[: h * factor, : w * factor].reshape(h, factor, w, factor).mean(axis=(1, 3))

lo, hi = float(grid.min()), float(grid.max())
relief = (grid - lo) / max(hi - lo, 1e-6)
if INVERT:
    relief = 1.0 - relief

os.makedirs(OUT_DIR, exist_ok=True)
np.ascontiguousarray(relief).astype("<f2").tofile(os.path.join(OUT_DIR, NAME + ".relief.bin"))
with open(os.path.join(OUT_DIR, NAME + ".relief.json"), "w") as f:
    json.dump(
        {"version": 1, "width": int(relief.shape[1]), "height": int(relief.shape[0]), "format": "r16f"},
        f,
        indent="\t",
    )
