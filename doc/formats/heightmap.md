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

Heights are altitudes in world units, and **the sea is at 0**: the web ground is `max(height, 0)`, a flat sea surface wherever the terrain dips below it (`SEA_LEVEL` in `terrain.glsl` and `ground.ts`). Export the seabed as it is: what lies below 0 gives the water its depth. Bake the lighting maps on the flattened terrain (`max(height, 0)`), so the shadows land on the water's surface.

## The far map (optional)

`farmap.bin` + `farmap.json`, **the same format**, exported by the same snippet (`NAME = "farmap"`): the surroundings at low resolution over a large area (for example 8 km at 512²) that contains the heightmap's footprint. The heightmap blends into it over its edge band, and it blends into the endless noise over its own (Far field → Blend, a fraction of each map's smaller side); the noise continues at its edges' mean height. Make it match the heightmap along the heightmap's edges (both from the same heightfield). Without it, the noise starts at the heightmap's edges. Terrain past the baked maps gets its cast shadows from the shadow ceiling (`drawables/terrain/shadow.frag`), which covers twice the heightmap around it (far mountains near it do cast shadows into it); further out, sun shading only.

## `heightmap.bin`

- IEEE 754 **half-float** (binary16), **little-endian**. In numpy: `astype('<f2').tofile(path)`.
- `width × height` values, row-major: `index = j * width + i`.
  - `i` runs along world **+X**, `j` along world **+Z**.
  - Row 0 becomes texture row 0, so texture `u` follows +X and `v` follows +Z.
- Values are **normalized to [0, 1]**: `worldY = bounds.min[1] + v * (bounds.max[1] - bounds.min[1])`.
  - Why normalized: half floats have relative precision. Storing absolute heights would make the precision depend on where the terrain sits in Y. Normalized storage gives about 11 bits over the whole height range, against 8 bits for a PNG.
- File size must be exactly `width * height * 2` bytes.

## `heightmap.json`

```json
{
  "version": 1,
  "width": 1024,
  "height": 1024,
  "format": "r16f",
  "bounds": { "min": [-500, 0, -500], "max": [500, 120, 500] }
}
```

| Field | Meaning |
|-------|---------|
| `version` | format version (see Versioning) |
| `width`, `height` | sample counts along X and Z |
| `format` | always `"r16f"` in v1 |
| `bounds.min/max` | world box `[x, y, z]`. X/Z are the **outer edges** of the sample grid, so sample centers sit at `min.x + (i + 0.5) * (max.x - min.x) / width` (same for Z with `j`, `height`). This matches GL texel centers. Y is the height range used to denormalize. |

## Coordinate system

Y-up, right-handed, with the same axes in Houdini and WebGL. The exporter does any flip needed to meet "`i` → +X, `j` → +Z".

## Loader (web)

- Import: `heightmap.bin?url` and `heightmap.json` directly.
- Check `version`, `format` and byte length; fail loudly on a mismatch.
- Upload: `texImage2D(TEXTURE_2D, 0, R16F, width, height, 0, RED, HALF_FLOAT, Uint16Array)` with `UNPACK_ALIGNMENT = 2`, `LINEAR` min/mag, `CLAMP_TO_EDGE`.
- Keep a CPU copy decoded to `Float32Array` (world heights) for picking and camera collision.

## Precision (and the fix, if it ever shows)

Half floats aren't evenly spaced: normalized to 0–1, the gap between two values is 1/2048 in the upper half of the range (finer below). Over 300 m of relief that's about 15 cm; over 1000 m, about 49 cm. On a steep, smooth slope the rounding repeats as a sawtooth. Seen on a 1000 m test ramp at 45°, not on a gentler terrain; two symptoms:

- **Zigzagging shadows:** the low sun turns a height error into a horizontal shift of the shadows (about ×2 at 26°), so thin shadows (the legend's) zigzag.
- **Bands along the contour lines:** the normal (`terrainNormal`, central differences one texel apart) jitters with the steps, so anything chosen from the slope does too. The rock rule (Ground colours) blending in around the ramp's 45° drew light bands following the height steps. A cheaper mitigation, without the fix: differences over two or more texels (a smoother normal).

Very likely to be implemented once real terrains with steep slopes come in. The fix:

- **File:** 16-bit unsigned integers, `"format": "r16"`, same layout and size (2 bytes per sample), evenly spaced: 65,536 levels (1.5 cm over 1000 m). The exporter writes `np.rint(normalized * 65535).astype('<u2')`. Loaders keep accepting `"r16f"` (the placeholder).
- **GPU:** no extension. 16-bit normalized textures need `EXT_texture_norm16` (not everywhere), float32 filtering needs `OES_texture_float_linear` (missing on many phones), and `R16UI` can't be filtered (a manual bilinear: four reads per height sample in the march, too slow on the phone). Instead, at load, split each height into two half floats in one **RG16F** texture (filterable in core WebGL2): R = half(v), G = (v − R) × 2048. Shaders read `r + g / 2048.0` (`mapHeight`, `farMapHeight` in `terrain.glsl`): bilinear filtering stays exact, since it's linear, and the march reads no more texels.
- **CPU:** `Heightfield` decodes the integers directly.
- **Cost:** GPU memory doubles (4 bytes per sample: 4 MB at 1024², 16 MB at 2048²), plus a one-off conversion at load (a few hundred ms at most on the phone for 2048²).

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
  - `cone`: a cone-ratio map in a sidecar `heightmap.cone.bin` (same layout, R16F).
