# Heightmap format (v1)

Contract between the exporters (Houdini Python SOP `hou/snippets/python/export_heightmap.py`, placeholder generator `web/scripts/gen-terrain.mjs`) and the web loader. Change it here first, then on both sides.

## Files

Two files with the same base name (`heightmap`, and `farmap` for the optional far map), in `web/src/lib/assets/terrain/`:

| File | Content |
|------|---------|
| `heightmap.bin` | height samples, no header: packed losslessly (`r16-med`, the exporter's) or raw (`r16`) |
| `heightmap.json` | metadata |

The baked lighting maps share the same footprint: [terrain-maps.md](terrain-maps.md).

## Altitude and the sea

Heights are altitudes in world units, and **the sea is at 0**: the web ground is `max(height, sea level)`, a flat sea surface wherever the terrain dips below it (`uSeaLevel` in `terrain.glsl`, `Ground`'s `sea.level`, the panel's Water → Sea level, 0 by contract). Export the seabed as it is: what lies below 0 gives the water its depth. Bake the lighting maps on the flattened terrain (`max(height, 0)`), so the shadows land on the water's surface.

## The far map (optional)

`farmap.bin` + `farmap.json`, **the same format**, exported by the same snippet (`NAME = "farmap"`): the surroundings at low resolution over a large area (for example 8 km at 512²) that contains the heightmap's footprint. The heightmap blends into it over its edge band, and it blends into the endless noise over its own (Far field → Blend, a fraction of each map's smaller side); the noise continues at its edges' mean height. Make it match the heightmap along the heightmap's edges (both from the same heightfield). Without it, the noise starts at the heightmap's edges. Terrain past the baked maps gets its cast shadows from the shadow ceiling (`drawables/terrain/shadow.frag`), which covers twice the heightmap around it (far mountains near it do cast shadows into it); further out, sun shading only.

## `heightmap.bin`

- **16-bit unsigned integers**, packed losslessly (`"format": "r16-med"`, what the exporter writes; see Packed below) or raw, little-endian (`"format": "r16"`, the exporter with `PACKED` off; in numpy: `np.rint(normalized * 65535).astype('<u2').tofile(path)`).
  - Older files, the placeholder among them: IEEE 754 half floats (`"format": "r16f"`, `astype('<f2')`), still read: rounded to 16-bit integers at load. Half floats aren't evenly spaced (see Precision).
- `width × height` values, row-major: `index = j * width + i`.
  - `i` runs along world **+X**, `j` along world **+Z**.
  - Row 0 becomes texture row 0, so texture `u` follows +X and `v` follows +Z.
- Values are **normalized to [0, 1]** (`r16`: the integer / 65535): `worldY = bounds.min[1] + v * (bounds.max[1] - bounds.min[1])`. Normalized storage spends every level on the terrain's own height range: 65,536 even steps, 1.5 cm over 1000 m.
- File size must be exactly `width * height * 2` bytes (for `r16-med`, once inflated).

### Packed: `r16-med`

The same integers in less than half the download (the 2048² terrain: 8 MB → 3.7 MB), exact. GitHub Pages doesn't compress `.bin` files, so the exporter does (`pack_med` in `export_heightmap.py`; the loader's `unpackMed` in `heightfield.ts` mirrors it: change both together):

1. A guess for each sample, from the samples before it (MED, as in lossless JPEG-LS). With `a` the sample on the left, `b` the one above, `c` the one above-left: `min(a, b)` if `c ≥ max(a, b)`, `max(a, b)` if `c ≤ min(a, b)`, else `a + b − c`. The first sample: 0; the rest of the first row: `a`; the first column: `b`.
2. The difference, sample minus guess, modulo 65536 (a wall can jump the whole range), read as a signed 16-bit number `d`.
3. Zigzagged, `z = (d << 1) ^ (d >> 15)`: small differences give small numbers.
4. All the high bytes of `z` (row-major), then all the low bytes.
5. Deflated, zlib format (Python's `zlib.compress`, the browser's `DecompressionStream('deflate')`).

Decoding runs it backwards, sample by sample in the same order. Checked exact on the 2048² terrain, and on noise with full-range jumps. The prediction carries it: plain deflate keeps 95 % of the raw size (the low bytes look like noise at 1.3 mm steps).

## `heightmap.json`

```json
{
  "version": 1,
  "width": 1024,
  "height": 1024,
  "format": "r16-med",
  "bounds": { "min": [-500, -40, -500], "max": [500, 120, 500] }
}
```

| Field | Meaning |
|-------|---------|
| `version` | format version (see Versioning) |
| `width`, `height` | sample counts along X and Z |
| `format` | `"r16-med"`: 16-bit unsigned integers, packed losslessly (the exporter's); `"r16"`: the same, raw; `"r16f"`: half floats (older files) |
| `bounds.min/max` | world box `[x, y, z]`. X/Z are the **outer edges** of the sample grid, so sample centers sit at `min.x + (i + 0.5) * (max.x - min.x) / width` (same for Z with `j`, `height`). This matches GL texel centers. Y is the height range used to denormalize. |

## Coordinate system

Y-up, right-handed, with the same axes in Houdini and WebGL. The exporter does any flip needed to meet "`i` → +X, `j` → +Z".

## Loader (web)

- Import: `heightmap.bin?url` and `heightmap.json` directly (the far map through an optional glob).
- Check `version`, `format` and byte length (once inflated, for `r16-med`); fail loudly on a mismatch.
- `r16-med`: inflated by the browser as it downloads (`DecompressionStream`), then unpacked in one pass (75 ms for 2048² on a desktop, a few times that on a phone, once).
- CPU copy (`terrain/heightfield.ts`): decoded to `Float32Array` world heights, for picking and camera collision.
- GPU copy: one **RG8** texture, the 16-bit integers' two bytes as they are, R the low byte, G the high one (no conversion at load). A texel's normalized value is the integer / 65535, which with the bytes read as 0..1 is `(256 g + r) / 257` (65535 = 255 × 257; `heightTexel` in `terrain.glsl`; fetched texels have their bytes rounded back to integers first, `heightTexelExact`). `LINEAR` min/mag, `CLAMP_TO_EDGE`, no mipmaps. Near the ground the shaders filter it themselves (see Precision).

## Precision

Half floats alone aren't evenly spaced: normalized to 0–1, the gap between two values is 1/2048 in the upper half of the range (finer below), 49 cm over 1000 m. On steep, smooth slopes the rounding repeats as a sawtooth, which showed on a 1000 m test ramp at 45°: thin shadows (the legend's) zigzagged, since the low sun turns a height error into a horizontal shift (about ×2 at 26°), and the rock rule banded along the contour lines, since the normal jittered. Hence the 16-bit integers (65,536 even steps).

The GPU needs no extension for them: the file's bytes go up as they are, two per sample, into an RG8 texture (core WebGL2; as much GPU memory as the file, 2 MB at 1024², 8 MB at 2048²), and the shaders put each sample back together. Exact: checked over all 65,536 values, even on a GPU that would convert the bytes at half precision, since they're rounded back to integers. Each single-channel format misses something: R16F holds 11 bits (the steps above, which no filtering can undo), R16UI is exact but the GPU can't filter it (the march's cheap steps need that), 16-bit normalized textures need `EXT_texture_norm16` (not everywhere), R32F takes 4 bytes and its filtering needs `OES_texture_float_linear` (missing on many phones). Bytes filter like any colour: filtering is linear, so the filtered bytes give the filtered height.

That alone didn't remove the steps: **hardware bilinear filtering isn't exact** either. Its weights are fixed point, with 8 bits of sub-texel precision (iq's "hardware interpolation" article), and some GPUs blend at half precision. On a steep slope at a grazing angle, the surface the march found was stepped once per texel (seen in the debug view: Light shafts → Debug view 2). So near the ground, and for the shading's normal, `terrain.glsl` filters the heights itself: four `texelFetch`es, the bilinear blend in fp32 (`heightExact`, `terrainHeight`, `terrainNormal`). The march's big steps, high above the ground, keep the one-read hardware filtering: its error (at worst about 1/4000 of the height range, on a GPU that blends at half precision) stays well inside the band where the march switches to the exact reads (1/1024 of the ground's height range). So do programs that don't set `uExactHeights` (dust, shadow ceiling). March → Exact heights switches it off (the cheap way everywhere).

## Size guidance

- WebGL2 guarantees `MAX_TEXTURE_SIZE ≥ 2048`. Stay at **≤ 2048** per side; non-power-of-two is fine.
- The download: raw, 1024² = 2 MB and 2048² = 8 MB; packed (`r16-med`), less than half that (the 2048² terrain: 3.7 MB). GitHub Pages doesn't compress `.bin` itself.

## Orientation check

Export a test pattern once and check it renders the same way in Houdini and in the browser: a ramp rising along +X plus a bump near the (+X, +Z) corner.

## Versioning

- New optional fields: no version bump. The loader ignores fields it doesn't know.
- Changing the meaning or layout of existing fields: bump `version`. The loader rejects versions it doesn't support.
- Planned optional fields:
  - `mips`: a max-height pyramid, either as a sidecar `.bin` or as offsets into one.
  - `cone`: a cone-ratio map in a sidecar `heightmap.cone.bin` (same layout).
