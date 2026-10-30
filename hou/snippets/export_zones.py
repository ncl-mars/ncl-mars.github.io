# Python SOP: exports the terrain's zones for the web: three soft masks the shader colours (palette in the dev
# panel). Format: doc/formats/terrain-maps.md (zones.png) -> zones.png (8-bit RGB, linear data).
# Tracking copy: the node snippet in the .hip is canonical.
#
# Pass-through (the geometry isn't modified). It writes on every cook: bypass the node when not exporting.
# Expects the heightfield layers named in ZONES, one per channel (R, G, B), values 0..1: 1 inside the zone,
# 0 outside, blurred over a few texels (the shader thresholds them at 0.5, so the edge stays crisp at any zoom,
# and the blur gives it bands near the edge). Lying in XZ like the height (no rotation; axis flips and swaps
# are handled), covering the same footprint as the exported heightmap. The sea and rock on steep slopes
# need no mask: the shader derives them from the height.

import json
import os
import struct
import zlib

import hou
import numpy as np

OUT_DIR = hou.text.expandString("$HIP/../web/src/lib/assets/terrain")
# Heightfield layer per channel: R, G, B (a missing one exports as an empty zone)
ZONES = ("zone1", "zone2", "zone3")
MAX_SIZE = 2048

geo = hou.pwd().geometry()


def layer(name):
    return next(
        (p for p in geo.prims() if isinstance(p, hou.Volume) and p.attribValue("name") == name),
        None,
    )


def grid(volume):
    """The layer as rows along +Z and columns along +X (row 0 = min Z), as export_heightmap.py does."""
    rx, ry, rz = volume.resolution()
    data = np.array(volume.allVoxels(), dtype=np.float32).reshape(ry, rx)  # [j][i], i varies fastest
    origin = np.array(volume.indexToPos((0, 0, 0)))
    di = np.array(volume.indexToPos((1, 0, 0))) - origin
    dj = np.array(volume.indexToPos((0, 1, 0))) - origin
    if abs(di[0]) >= abs(di[2]):
        g, x_step, z_step = data, di[0], dj[2]
    else:
        g, x_step, z_step = data.T, dj[0], di[2]
    if x_step < 0:
        g = g[:, ::-1]
    if z_step < 0:
        g = g[::-1, :]
    return g


def footprint(volume):
    """The layer's outer edges in x and z: boundingBox() runs through the voxel centres, half a voxel in."""
    origin = np.array(volume.indexToPos((0, 0, 0)))
    voxel = np.abs(np.array(volume.indexToPos((1, 1, 0))) - origin)  # one voxel along both axes
    bbox = volume.boundingBox()
    return (
        bbox.minvec()[0] - voxel[0] / 2,
        bbox.minvec()[2] - voxel[2] / 2,
        bbox.maxvec()[0] + voxel[0] / 2,
        bbox.maxvec()[2] + voxel[2] / 2,
    )


def write_png(path, pixels):
    """8-bit RGB PNG without colour chunks (gamma, ICC, sRGB): the browser must read the values as they are."""
    height, width, _ = pixels.shape
    raw = b"".join(b"\x00" + pixels[j].tobytes() for j in range(height))  # filter 0 on every row

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8 bits, RGB, no interlace
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


volumes = [layer(name) for name in ZONES]
present = [v for v in volumes if v is not None]
if not present:
    raise hou.NodeError(f"None of the zone layers {ZONES} in the input (ZONES at the top of the script)")
shape = grid(present[0]).shape
channels = [grid(v) if v is not None else np.zeros(shape, dtype=np.float32) for v in volumes]
if any(c.shape != shape for c in channels):
    raise hou.NodeError(f"The zone layers {ZONES} must have the same resolution")
if max(shape) > MAX_SIZE:
    raise hou.NodeError(f"{shape[1]} x {shape[0]}: stay at {MAX_SIZE} per side or less (WebGL2's guaranteed texture size)")

meta_path = os.path.join(OUT_DIR, "heightmap.json")
if os.path.exists(meta_path):
    with open(meta_path) as f:
        bounds = json.load(f)["bounds"]
    expected = (bounds["min"][0], bounds["min"][2], bounds["max"][0], bounds["max"][2])
    actual = footprint(present[0])
    size = max(expected[2] - expected[0], expected[3] - expected[1])
    if max(abs(a - e) for a, e in zip(actual, expected)) > 1e-3 * size:
        raise hou.NodeError(
            f"The zones cover x/z {actual}, the exported heightmap {expected}: export both from the same heightfield"
        )

pixels = np.ascontiguousarray(np.clip(np.rint(np.stack(channels, axis=-1) * 255.0), 0, 255).astype(np.uint8))
os.makedirs(OUT_DIR, exist_ok=True)
write_png(os.path.join(OUT_DIR, "zones.png"), pixels)  # file row 0 = min Z, as the format expects
