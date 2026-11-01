# Python SOP: exports the heightfield's `height` volume for the web terrain.
# Format: doc/formats/heightmap.md -> <NAME>.bin (16-bit unsigned integers, normalized over the height range:
# 65536 even steps; packed losslessly, 'r16-med', unless PACKED is off) + <NAME>.json.
# Tracking copy: the node snippet in the .hip is canonical.
#
# Pass-through (the geometry isn't modified). It writes on every cook: bypass the node when not exporting.
# Expects a heightfield lying in XZ (no rotation); axis flips and swaps are handled below.
# Heights are altitudes: the sea is at 0, and what lies below it (the seabed) gives the water its depth.
# Two exports, two nodes: NAME = "heightmap" (the detailed terrain), "farmap" (the surroundings, low
# resolution, a large area containing the heightmap's footprint).

import json
import os
import zlib

import hou
import numpy as np

OUT_DIR = hou.text.expandString("$HIP/../web/src/lib/assets/terrain")
NAME = "heightmap"
# 'r16-med': the same integers, packed losslessly (about half the download). Off: raw 'r16', little-endian
PACKED = True


def pack_med(q):
    """'r16-med' (doc/formats/heightmap.md): each sample stored as its difference from a guess made from the
    samples before it (MED, as in lossless JPEG-LS: the left, top or planar guess depending on the local edge),
    modulo 65536 (a wall can jump the whole range), zigzagged (small differences, small numbers), high bytes
    then low bytes, deflated. Lossless: the web gets back the same integers."""
    v = q.astype(np.int64)
    guess = np.zeros_like(v)
    a, b, c = v[1:, :-1], v[:-1, 1:], v[:-1, :-1]  # left, top, top-left of the inner samples
    low, high = np.minimum(a, b), np.maximum(a, b)
    guess[1:, 1:] = np.where(c >= high, low, np.where(c <= low, high, a + b - c))
    guess[0, 1:] = v[0, :-1]  # first row: the sample on the left
    guess[1:, 0] = v[:-1, 0]  # first column: the sample above
    d = (v - guess + 32768) % 65536 - 32768  # the difference modulo 65536, as a signed 16-bit number
    z = ((d << 1) ^ (d >> 15)) & 0xFFFF  # zigzag: 0, -1, 1, -2... -> 0, 1, 2, 3...
    planes = np.concatenate([(z >> 8).ravel(), (z & 0xFF).ravel()]).astype(np.uint8)
    return zlib.compress(planes.tobytes(), 9)


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
samples = np.ascontiguousarray(np.rint(normalized * 65535.0)).astype(np.uint16)

# The format wants the outer edges of the voxels; boundingBox() runs through their centres, half a voxel in
bbox = volume.boundingBox()
half_x, half_z = abs(x_step) / 2, abs(z_step) / 2
meta = {
    "version": 1,
    "width": int(grid.shape[1]),
    "height": int(grid.shape[0]),
    "format": "r16-med" if PACKED else "r16",
    "bounds": {
        "min": [bbox.minvec()[0] - half_x, lo, bbox.minvec()[2] - half_z],
        "max": [bbox.maxvec()[0] + half_x, hi, bbox.maxvec()[2] + half_z],
    },
}

os.makedirs(OUT_DIR, exist_ok=True)
with open(os.path.join(OUT_DIR, NAME + ".bin"), "wb") as f:
    f.write(pack_med(samples) if PACKED else samples.astype("<u2").tobytes())
with open(os.path.join(OUT_DIR, NAME + ".json"), "w") as f:
    json.dump(meta, f, indent="\t")
