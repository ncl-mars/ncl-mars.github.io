# Python SOP: exports the baked lighting maps for the web terrain, and the sun direction they were baked with.
# Format: doc/formats/terrain-maps.md -> maps.png (8-bit RGB, linear: R direct light with its shadows,
# G ambient occlusion, B cavity) + maps.json (sunDir).
# Tracking copy: the node snippet in the .hip is canonical.
#
# Pass-through (the geometry isn't modified). It writes on every cook: bypass the node when not exporting.
# Expects:
# - the baked heightfield layers named in LAYERS, values 0..1, lying in XZ like the height (no rotation;
#   axis flips and swaps are handled), covering the same footprint as the exported heightmap, baked on the
#   flattened terrain (max(height, 0)) so the shadows land on the sea's surface;
# - a detail vector attribute `sun_dir` pointing TOWARD the sun: the very vector the bake used. The web
#   lights everything else with it (fog glow, god rays, legend shadows), so they match the baked shadows.
#   If your bake's direction is the light's travel (sun to ground), set sun_dir to its negation.

import json
import os
import struct
import zlib

import hou
import numpy as np

OUT_DIR = hou.text.expandString("$HIP/../web/src/lib/assets/terrain")
# Heightfield layer per channel: R direct light (0 = fully shadowed), G ambient occlusion (1 = open sky),
# B cavity (0.5 = flat, below concave, above convex)
LAYERS = ("light", "occlusion", "cavity")
# Noise under one 8-bit step, so smooth dark gradients don't band under the fog (terrain-maps.md, Precision)
DITHER = True
MAX_SIZE = 2048

geo = hou.pwd().geometry()


def layer(name):
    volume = next(
        (p for p in geo.prims() if isinstance(p, hou.Volume) and p.attribValue("name") == name),
        None,
    )
    if volume is None:
        raise hou.NodeError(f"No '{name}' layer in the input (LAYERS at the top of the script)")
    return volume


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


def write_png(path, pixels):
    """8-bit RGB PNG without colour chunks (gamma, ICC, sRGB): the browser must read the values as they are."""
    height, width, _ = pixels.shape
    raw = b"".join(b"\x00" + pixels[j].tobytes() for j in range(height))  # filter 0 on every row

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8 bits, RGB, no interlace
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


# The sun, as baked
if geo.findGlobalAttrib("sun_dir") is None:
    raise hou.NodeError("Needs a detail vector attribute 'sun_dir': toward the sun, the vector the bake used")
sun = np.array(geo.attribValue("sun_dir"), dtype=np.float64)
length = float(np.linalg.norm(sun))
if length < 1e-6:
    raise hou.NodeError("sun_dir is zero")
sun /= length
if sun[1] <= 0:
    raise hou.NodeError("sun_dir points below the horizon: it should point toward the sun")

# The three layers, same resolution, same footprint as the heightmap
volumes = [layer(name) for name in LAYERS]
channels = [grid(v) for v in volumes]
shape = channels[0].shape
if any(c.shape != shape for c in channels):
    raise hou.NodeError(f"The layers {LAYERS} must have the same resolution")
if max(shape) > MAX_SIZE:
    raise hou.NodeError(f"{shape[1]} x {shape[0]}: stay at {MAX_SIZE} per side or less (WebGL2's guaranteed texture size)")

bbox = volumes[0].boundingBox()
meta_path = os.path.join(OUT_DIR, "heightmap.json")
if os.path.exists(meta_path):
    with open(meta_path) as f:
        bounds = json.load(f)["bounds"]
    expected = (bounds["min"][0], bounds["min"][2], bounds["max"][0], bounds["max"][2])
    actual = (bbox.minvec()[0], bbox.minvec()[2], bbox.maxvec()[0], bbox.maxvec()[2])
    size = max(expected[2] - expected[0], expected[3] - expected[1])
    if max(abs(a - e) for a, e in zip(actual, expected)) > 1e-3 * size:
        raise hou.NodeError(
            f"The maps cover x/z {actual}, the exported heightmap {expected}: export both from the same heightfield"
        )

rgb = np.stack(channels, axis=-1)
if DITHER:
    rgb = rgb + (np.random.default_rng(0).random(rgb.shape, dtype=np.float32) - 0.5) / 255.0
pixels = np.ascontiguousarray(np.clip(np.rint(rgb * 255.0), 0, 255).astype(np.uint8))

os.makedirs(OUT_DIR, exist_ok=True)
write_png(os.path.join(OUT_DIR, "maps.png"), pixels)  # file row 0 = min Z, as the format expects
with open(os.path.join(OUT_DIR, "maps.json"), "w") as f:
    json.dump({"version": 1, "sunDir": [round(float(v), 6) for v in sun]}, f, indent="\t")
