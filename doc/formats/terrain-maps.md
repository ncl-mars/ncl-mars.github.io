# Terrain maps format (v1)

Grayscale lighting data baked in Houdini for the terrain. It is the companion to [heightmap.md](heightmap.md) and covers the same footprint. Contract between the Houdini exporter (`hou/snippets/export_maps.py`) and the web loader. Change it here first, then on both sides.

## Houdini

The Python SOP `export_maps.py` reads three heightfield layers (`shadow`, `occlusion`, `cavity` by default, `LAYERS` at its top), values 0–1, and a detail vector attribute `v@sun_dir` pointing **toward** the sun: the same vector the bake used, so the web's sun (its light on the slopes, fog glow, god rays, legend shadows) matches the baked shadows. It writes `maps.png` (no colour chunks, a hint of dither) and `maps.json`, refuses layers of different resolutions, over 2048 per side, a `sun_dir` below the horizon, and a footprint that differs from the exported `heightmap.json`. Pass-through, writes on every cook: bypass it when not exporting.

The layers are baked in Copernicus on the height flattened at the sea (`max(height, 0)`), then imported into SOPs: `shadow` by the OpenCL COP `hou/snippets/bake_shadow.cl` (the sun's soft cast shadow, from its `sun_dir` parameter, which `v@sun_dir` references with `chv`; baked on the heights at full resolution, then downsampled to the maps' resolution, so small occluders keep their shadows), `occlusion` by Height to Ambient Occlusion (1 = open sky), `cavity` by Curvature remapped around 0.5 (crests above). Those two nodes must read the heights at the ground's scale (metres over the image's width), or slopes come out far too steep.

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
| R | the fixed sun's cast shadow: 1 where it reaches the ground, 0 in shadow, a soft penumbra between. Not the sun's angle on the slope (n·L): the shader computes it from the heightmap's normal, as sharp as the heights |
| G | ambient occlusion (1 = unoccluded) |
| B | cavity / curvature (0.5 = flat, < 0.5 concave, > 0.5 convex) |

## `maps.json`

```json
{
  "version": 2,
  "sunDir": [0.6, 0.25, -0.76]
}
```

| Field | Meaning |
|-------|---------|
| `version` | format version (same rules as the heightmap): 2 since R holds the shadow alone |
| `sunDir` | unit vector **toward** the sun, in world space, exactly the one used for the bake. The web lights the slopes with it (n·L, from the heightmap's normal), and the fog's sun glow, the light shafts and the legend shadows, so everything matches the bake. |

## Footprint and orientation

- Same XZ footprint as the heightmap: the `bounds` from `heightmap.json`, measured at the outer edges of the pixel grid.
- `u = (x - min.x) / (max.x - min.x)`, `v = (z - min.z) / (max.z - min.z)`.
- X runs left → right. Stored image row 0 (the top row in the file) is `z = min.z`, the same order as heightmap rows.
- The resolution is independent of the heightmap's, and can be lower: the light's detail comes from the heightmap's normal, and the maps hold what stays smooth at that scale (shadows, AO, cavity). For example 2048² heights over 1024² maps. Stay at **≤ 2048** per side unless tested on the weak device.
- Check orientation with the heightmap test pattern (ramp along +X, bump near the +X/+Z corner).

## Loader (web)

- Decode with `createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })`, so the browser doesn't alter the values.
- Upload as `RGBA8`, **not** `SRGB8_ALPHA8`. Use `LINEAR_MIPMAP_LINEAR` / `LINEAR` with `generateMipmap` (averaging is fine for these channels) and `CLAMP_TO_EDGE`.

## Precision

8 bits per channel. If banding shows in smooth dark gradients under the fog, first add dithering at export. If that isn't enough, move to a half-float `.bin` like the heightmap.

## Zones: `zones.png` (optional)

What kind of ground each place is, for the shader to colour (palette in the dev panel), from `hou/snippets/export_zones.py`.

- Lossless 8-bit **RGB** (no alpha: browsers may premultiply it, and WebP may rewrite the colour under transparent pixels), linear data, no gamma or ICC profile. Imported like `maps.png` (`?lossless&format=webp`).
- Same footprint and orientation as `maps.png` (see above); its own resolution, ≤ 2048 per side.
- **R, G, B: three zones' soft masks.** 1 inside the zone, 0 outside, **blurred over a few texels** (2 to 4): the shader thresholds each at 0.5, so the zone's edge stays crisp at any zoom, and the gradient gives it bands near the edge (a fringe, a darker rim). Where masks overlap, the later channel wins (B over G over R).
- Where no mask is set: the base ground colour. The sea (altitude below 0: colour from the depth, foam at the shore) and rock on steep slopes need no mask: the shader derives them from the height.
- Meaning is the palette's: zone 1, 2, 3 are coloured in the panel (Ground colours), over the base tint, under rock on steep slopes. Optional: without the file, no zone anywhere.

In Houdini: one heightfield layer per zone (`zone1`, `zone2`, `zone3` by default, `ZONES` at the top of the snippet; a missing one exports empty), blurred a few texels. The snippet refuses layers of different resolutions, over 2048 per side, and a footprint that differs from the exported `heightmap.json`.

## Versioning

- New optional fields or channels in a sidecar file: no version bump.
- Changing the meaning of a channel or field: bump `version`.
- Version 2 (2026-11-01): R is the cast shadow alone. Version 1 baked the light (the sun's angle on the slope × the shadow); the loader refuses it and asks for a re-export.
