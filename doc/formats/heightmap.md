# Heightmap format (v1)

Contract between the exporters (Houdini Python SOP `hou/snippets/export_heightmap.py`, placeholder generator `web/scripts/gen-terrain.mjs`) and the web loader. Change it here first, then on both sides.

## Files

Two files with the same base name (`heightmap`, and `farmap` for the optional far map), in `web/src/lib/assets/terrain/`:

| File | Content |
|------|---------|
| `heightmap.bin` | raw height samples, no header |
| `heightmap.json` | metadata |

The baked lighting maps share the same footprint: [terrain-maps.md](terrain-maps.md).

## Altitude and the sea

Heights are altitudes in world units, and **the sea is at 0**: the web ground is `max(height, sea level)`, a flat sea surface wherever the terrain dips below it (`uSeaLevel` in `terrain.glsl`, `Ground`'s `sea.level`, the panel's Water → Sea level, 0 by contract). Export the seabed as it is: what lies below 0 gives the water its depth. Bake the lighting maps on the flattened terrain (`max(height, 0)`), so the shadows land on the water's surface.

## The far map (optional)

`farmap.bin` + `farmap.json`, **the same format**, exported by the same snippet (`NAME = "farmap"`): the surroundings at low resolution over a large area (for example 8 km at 512²) that contains the heightmap's footprint. The heightmap blends into it over its edge band, and it blends into the endless noise over its own (Far field → Blend, a fraction of each map's smaller side); the noise continues at its edges' mean height. Make it match the heightmap along the heightmap's edges (both from the same heightfield). Without it, the noise starts at the heightmap's edges. Terrain past the baked maps gets its cast shadows from the shadow ceiling (`drawables/terrain/shadow.frag`), which covers twice the heightmap around it (far mountains near it do cast shadows into it); further out, sun shading only.

## `heightmap.bin`

- **16-bit unsigned integers, little-endian** (`"format": "r16"`, what the exporter writes). In numpy: `np.rint(normalized * 65535).astype('<u2').tofile(path)`.
  - Older files, the placeholder among them: IEEE 754 half floats (`"format": "r16f"`, `astype('<f2')`), still read. Half floats aren't evenly spaced (see Precision).
- `width × height` values, row-major: `index = j * width + i`.
  - `i` runs along world **+X**, `j` along world **+Z**.
  - Row 0 becomes texture row 0, so texture `u` follows +X and `v` follows +Z.
- Values are **normalized to [0, 1]** (`r16`: the integer / 65535): `worldY = bounds.min[1] + v * (bounds.max[1] - bounds.min[1])`. Normalized storage spends every level on the terrain's own height range: 65,536 even steps, 1.5 cm over 1000 m.
- File size must be exactly `width * height * 2` bytes.

## `heightmap.json`

```json
{
  "version": 1,
  "width": 1024,
  "height": 1024,
  "format": "r16",
  "bounds": { "min": [-500, -40, -500], "max": [500, 120, 500] }
}
```

| Field | Meaning |
|-------|---------|
| `version` | format version (see Versioning) |
| `width`, `height` | sample counts along X and Z |
| `format` | `"r16"`: 16-bit unsigned integers (the exporter's); `"r16f"`: half floats (older files) |
| `bounds.min/max` | world box `[x, y, z]`. X/Z are the **outer edges** of the sample grid, so sample centers sit at `min.x + (i + 0.5) * (max.x - min.x) / width` (same for Z with `j`, `height`). This matches GL texel centers. Y is the height range used to denormalize. |

## Coordinate system

Y-up, right-handed, with the same axes in Houdini and WebGL. The exporter does any flip needed to meet "`i` → +X, `j` → +Z".

## Loader (web)

- Import: `heightmap.bin?url` and `heightmap.json` directly (the far map through an optional glob).
- Check `version`, `format` and byte length; fail loudly on a mismatch.
- CPU copy (`terrain/heightfield.ts`): decoded to `Float32Array` world heights, for picking and camera collision.
- GPU copy: one **RG16F** texture, each normalized height split into two half floats, R = half(v), G = half((v − R) × 2048); the shaders read `r + g / 2048.0` (`mapHeight`, `farMapHeight` in `terrain.glsl`). `LINEAR` min/mag, `CLAMP_TO_EDGE`, no mipmaps. See Precision for why.

## Precision

Half floats alone aren't evenly spaced: normalized to 0–1, the gap between two values is 1/2048 in the upper half of the range (finer below), 49 cm over 1000 m. On steep, smooth slopes the rounding repeats as a sawtooth, which showed on a 1000 m test ramp at 45°: thin shadows (the legend's) zigzagged, since the low sun turns a height error into a horizontal shift (about ×2 at 26°), and the rock rule banded along the contour lines, since the normal jittered. Hence the 16-bit integers (65,536 even steps).

The GPU needs no extension for them: 16-bit normalized textures would need `EXT_texture_norm16` (not everywhere), float32 filtering `OES_texture_float_linear` (missing on many phones), and `R16UI` can't be filtered (a manual bilinear: four reads per height sample in the march, too slow on the phone). Split into two half floats in one RG16F texture (filterable in core WebGL2), the integers come back to 0.004 of a step (checked over all 65,536 values), bilinear filtering stays exact since it's linear, and the march reads no more texels. Cost: GPU memory doubles (4 bytes per sample: 4 MB at 1024², 16 MB at 2048²), and a one-off conversion at load.

## Size guidance

- WebGL2 guarantees `MAX_TEXTURE_SIZE ≥ 2048`. Stay at **≤ 2048** per side; non-power-of-two is fine.
- The download is the raw size (1024² = 2 MB, 2048² = 8 MB). Don't count on GitHub Pages compressing `.bin`.

## Orientation check

Export a test pattern once and check it renders the same way in Houdini and in the browser: a ramp rising along +X plus a bump near the (+X, +Z) corner.

## Versioning

- New optional fields: no version bump. The loader ignores fields it doesn't know.
- Changing the meaning or layout of existing fields: bump `version`. The loader rejects versions it doesn't support.
- Planned optional fields:
  - `mips`: a max-height pyramid, either as a sidecar `.bin` or as offsets into one.
  - `cone`: a cone-ratio map in a sidecar `heightmap.cone.bin` (same layout).
