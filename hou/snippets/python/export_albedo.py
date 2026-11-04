# Python SOP: exports the ground's colour for the web terrain. Format: doc/formats/terrain-maps.md (albedo.png,
# faralbedo.png) -> <NAME>.png (8-bit RGB, display values).
# Tracking copy: the node snippet in the .hip is canonical.
#
# Pass-through (the geometry isn't modified). It writes on every cook: bypass the node when not exporting.
# Expects the RGB layer named in LAYER, made in Copernicus and imported into SOPs (there one volume with three
# channels, R, G, B; an RGBA layer's alpha is ignored), values 0..1: the ground's albedo only (no AO, cavity,
# shadow or light: maps.png has them), already converted to display values (sRGB), since the web reads them
# as they are. Lying in XZ like the height (no rotation; axis flips and swaps are handled). Under the sea it's
# unused (the water's colour comes from its depth). Reads, checks, packs: the colour is made in Copernicus.
# Two exports, two nodes: NAME = "albedo" (over the heightmap, its footprint), "faralbedo" (over the far map,
# its footprint).

import json
import os
import struct
import zlib

import hou
import numpy as np

OUT_DIR = hou.text.expandString("$HIP/../web/src/lib/assets/terrain")
NAME = "albedo"
# The RGB layer from Copernicus
LAYER = "albedo"
MAX_SIZE = 2048
# Each export's footprint: the exported heights it lies on
FOOTPRINTS = {"albedo": "heightmap.json", "faralbedo": "farmap.json"}

geo = hou.pwd().geometry()
if NAME not in FOOTPRINTS:
    raise hou.NodeError(f"NAME must be one of {tuple(FOOTPRINTS)}")


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

meta_path = os.path.join(OUT_DIR, FOOTPRINTS[NAME])
if os.path.exists(meta_path):
    with open(meta_path) as f:
        bounds = json.load(f)["bounds"]
    expected = (bounds["min"][0], bounds["min"][2], bounds["max"][0], bounds["max"][2])
    actual = footprint(volume)
    size = max(expected[2] - expected[0], expected[3] - expected[1])
    if max(abs(a - e) for a, e in zip(actual, expected)) > 1e-3 * size:
        raise hou.NodeError(
            f"'{LAYER}' covers x/z {actual}, the exported {FOOTPRINTS[NAME]} {expected}: they must cover the same ground"
        )

pixels = np.ascontiguousarray(np.clip(np.rint(np.stack(channels, axis=-1) * 255.0), 0, 255).astype(np.uint8))
os.makedirs(OUT_DIR, exist_ok=True)
write_png(os.path.join(OUT_DIR, f"{NAME}.png"), pixels)  # file row 0 = min Z, as the format expects
