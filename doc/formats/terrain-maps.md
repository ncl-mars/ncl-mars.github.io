# Terrain maps format (v1)

Grayscale lighting data baked in Houdini for the terrain. It is the companion to [heightmap.md](heightmap.md) and covers the same footprint. Contract between the Houdini exporter (`hou/snippets/export_maps.py`) and the web loader. Change it here first, then on both sides.

## Houdini

The Python SOP `export_maps.py` reads three heightfield layers (`light`, `occlusion`, `cavity` by default, `LAYERS` at its top), values 0–1, and a detail vector attribute `v@sun_dir` pointing **toward** the sun: the same vector the bake used, so the web's sun (fog glow, god rays, legend shadows) matches the baked shadows. It writes `maps.png` (no colour chunks, a hint of dither) and `maps.json`, refuses layers of different resolutions, over 2048 per side, a `sun_dir` below the horizon, and a footprint that differs from the exported `heightmap.json`. Pass-through, writes on every cook: bypass it when not exporting.

## Files

In `web/src/lib/assets/terrain/`:

| File | Content |
|------|---------|
| `maps.png` | lossless 8-bit RGB, linear data (see Channels). Imported through imagetools (`?lossless&format=webp`) to get the URL. |
| `maps.json` | metadata |

## Channels

All values are **linear data in 0–1**, not sRGB colour. Export without gamma and without an ICC profile.

| Channel | Meaning |
|---------|---------|
| R | direct light from the fixed sun, shadows included (0 = fully shadowed) |
| G | ambient occlusion (1 = unoccluded) |
| B | cavity / curvature (0.5 = flat, < 0.5 concave, > 0.5 convex) |

## `maps.json`

```json
{
  "version": 1,
  "sunDir": [0.6, 0.25, -0.76]
}
```

| Field | Meaning |
|-------|---------|
| `version` | format version (same rules as the heightmap) |
| `sunDir` | unit vector **toward** the sun, in world space, exactly the one used for the bake. The web side reuses it for pit lighting, fog sun glow and cord shadows, so everything matches the bake. |

## Footprint and orientation

- Same XZ footprint as the heightmap: the `bounds` from `heightmap.json`, measured at the outer edges of the pixel grid.
- `u = (x - min.x) / (max.x - min.x)`, `v = (z - min.z) / (max.z - min.z)`.
- X runs left → right. Stored image row 0 (the top row in the file) is `z = min.z`, the same order as heightmap rows.
- The resolution is independent of the heightmap and can be higher. Stay at **≤ 2048** per side unless tested on the weak device.
- Check orientation with the heightmap test pattern (ramp along +X, bump near the +X/+Z corner).

## Loader (web)

- Decode with `createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })`, so the browser doesn't alter the values.
- Upload as `RGBA8`, **not** `SRGB8_ALPHA8`. Use `LINEAR_MIPMAP_LINEAR` / `LINEAR` with `generateMipmap` (averaging is fine for these channels) and `CLAMP_TO_EDGE`.

## Precision

8 bits per channel. If banding shows in smooth dark gradients under the fog, first add dithering at export. If that isn't enough, move to a half-float `.bin` like the heightmap.

## Versioning

- New optional fields or channels in a sidecar file: no version bump.
- Changing the meaning of a channel or field: bump `version`.
