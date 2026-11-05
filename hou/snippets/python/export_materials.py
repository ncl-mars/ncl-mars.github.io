# Python SOP: exports the terrain's materials for the web: three soft masks, R metal, G gloss, B spare; the
# ground is the rest. Format: doc/formats/terrain-maps.md (materials.png) -> materials.png (8-bit RGB, linear
# data).
# Tracking copy: the node snippet in the .hip is canonical.
#
# Pass-through (the geometry isn't modified). It writes on every cook: bypass the node when not exporting.
# Expects the RGB layer named in LAYER, made in Copernicus and imported into SOPs (there one volume with three
# channels, R metal, G gloss, B spare, an unused one black; an RGBA layer's alpha is ignored), values 0..1: 1
# inside the material, 0 outside, all blurred the same over 2 to 4 texels, so they add up to 1 at most (where
# they're steep, the shader picks the largest weight, anti-aliased, so the edge stays crisp at any zoom; where
# they ramp gently, they blend). Lying in XZ like the height (no rotation; axis flips and swaps are handled),
# covering the same footprint as the exported heightmap. The sea needs no mask: the shader derives it from the
# height. Reads, checks, packs: the masks are made in Copernicus.

import json
import os
import struct
import zlib

import hou
import numpy as np

OUT_DIR = hou.text.expandString("$HIP/../web/src/lib/assets/terrain")
# The RGB layer from Copernicus: R metal, G gloss, B spare
LAYER = "materials"
MAX_SIZE = 2048

geo = hou.pwd().geometry()


def rgb_layer(name):
    """The layer's volume: one, with at least three channels."""
    volume = next(
        (p for p in geo.prims() if isinstance(p, hou.Volume) and p.attribValue("name") == name),
        None,
    )
    if volume is None:
        raise hou.NodeError(f"No '{name}' layer in the input (LAYER at the top of the script)")
    if volume.channelCount() < 3:
        raise hou.NodeError(f"'{name}' has {volume.channelCount()} channel(s): it must be an RGB layer")
    if volume.storageType() != hou.volumeStorageType.Float:
        raise hou.NodeError(f"'{name}' stores integers: it must be a float RGB layer")
    return volume


def rgb(volume):
    """R, G, B as [j][i] arrays (i varies fastest): allVoxelsAsString interleaves the channels, as 32-bit floats."""
    rx, ry, rz = volume.resolution()
    count = volume.channelCount()
    data = np.frombuffer(volume.allVoxelsAsString(), dtype=np.float32)
    if data.size != rx * ry * count:
        raise hou.NodeError(f"'{LAYER}': {data.size} values for {rx} x {ry} voxels of {count} channels")
    return list(data.reshape(ry, rx, count).transpose(2, 0, 1)[:3])


def grid(volume, data):
    """data [j][i] as rows along +Z and columns along +X (row 0 = min Z), as export_heightmap.py does."""
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


volume = rgb_layer(LAYER)
channels = [grid(volume, c) for c in rgb(volume)]
shape = channels[0].shape
if max(shape) > MAX_SIZE:
    raise hou.NodeError(f"{shape[1]} x {shape[0]}: stay at {MAX_SIZE} per side or less (WebGL2's guaranteed texture size)")

meta_path = os.path.join(OUT_DIR, "heightmap.json")
if os.path.exists(meta_path):
    with open(meta_path) as f:
        bounds = json.load(f)["bounds"]
    expected = (bounds["min"][0], bounds["min"][2], bounds["max"][0], bounds["max"][2])
    actual = footprint(volume)
    size = max(expected[2] - expected[0], expected[3] - expected[1])
    if max(abs(a - e) for a, e in zip(actual, expected)) > 1e-3 * size:
        raise hou.NodeError(
            f"'{LAYER}' covers x/z {actual}, the exported heightmap {expected}: they must cover the same ground"
        )

pixels = np.ascontiguousarray(np.clip(np.rint(np.stack(channels, axis=-1) * 255.0), 0, 255).astype(np.uint8))
os.makedirs(OUT_DIR, exist_ok=True)
write_png(os.path.join(OUT_DIR, "materials.png"), pixels)  # file row 0 = min Z, as the format expects
