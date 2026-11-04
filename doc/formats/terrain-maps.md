# Terrain maps format (v2)

Image data baked in Houdini for the terrain: the lighting maps (`maps.png`), and optionally its materials (`materials.png`) and the ground's colour (`albedo.png`). The companion to [heightmap.md](heightmap.md), over the same footprint. Contract between the Houdini exporters (`hou/snippets/python/export_maps.py`, `export_materials.py`, `export_albedo.py`) and the web loader. Change it here first, then on both sides.

## Houdini

The Python SOP `export_maps.py` reads three heightfield layers (`shadow`, `occlusion`, `cavity` by default, `LAYERS` at its top), values 0–1, and a detail vector attribute `v@sun_dir` pointing **toward** the sun: the same vector the bake used, so the web's sun (its light on the slopes, fog glow, god rays, legend shadows) matches the baked shadows. It writes `maps.png` (no colour chunks, a hint of dither) and `maps.json`, refuses layers of different resolutions, over 2048 per side, a `sun_dir` below the horizon, and a footprint that differs from the exported `heightmap.json`. Pass-through, writes on every cook: bypass it when not exporting.

The layers are baked in Copernicus on the height flattened at the sea (`max(height, 0)`), then imported into SOPs: `shadow` by the OpenCL COP `hou/snippets/ocl/bake_shadow.cl` (the sun's soft cast shadow, from its `sun_dir` parameter, which `v@sun_dir` references with `chv`; baked on the heights at full resolution, then downsampled to the maps' resolution, so small occluders keep their shadows), `occlusion` by Height to Ambient Occlusion (1 = open sky), `cavity` by Curvature remapped around 0.5 (crests above). Those two nodes must read the heights at the ground's scale (metres over the image's width), or slopes come out far too steep. Keep Height to Ambient Occlusion's radius around 10 to 20 m (10 to 20 pixels at 2048² over the 2 km site): larger, every low area sees distant hills as walls, and open water and plains go dark; detail finer than about 5 m is the cavity's job.

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

## Materials: `materials.png` (optional)

What each place is made of, for the shader to light it, from `hou/snippets/python/export_materials.py`.

- Lossless 8-bit **RGB** (no alpha: browsers may premultiply it, and WebP may rewrite the colour under transparent pixels), linear data, no gamma or ICC profile. Imported like `maps.png` (`?lossless&format=webp`).
- Same footprint and orientation as `maps.png` (see above); its own resolution, ≤ 2048 per side. 2048² matches the heights, so the materials' edges follow the objects' walls; masks that are mostly flat compress well.
- **R metal, G gloss, B spare; the ground is the rest** (1 − R − G − B), so together they add up to 1 at most. Each mask is 1 inside its material and 0 outside, its edges **all blurred the same, over 2 to 4 texels**. Where the masks are that steep, the shader picks the material with the largest weight, anti-aliased against the runner-up: the edges stay crisp at any zoom, and where three materials meet, none leaves a gap.
- **Gradients blend.** Where the masks ramp gently, over more than the panel's Blend width (Materials, 8 texels by default; fully from twice that), the materials blend by their values, as painted: sand drifting over a ring is its metal mask fading as the ground takes over. On two levels: the objects (metal, gloss and spare together, so an object's outline is their union) against the ground, then each material within the objects, so a gem's edge stays crisp under the same sand. The ground's colour shows wherever the objects' masks thin out: paint the sand into `albedo.png` under them too.
- How each is lit is the panel's (Materials: a colour, how metallic, how rough). Metal reflects the sky and the sun in its own colour; gloss reflects them over its colour (glass, lacquer, polished stone); spare is free. The ground is matte (see `albedo.png`). The sea (altitude below 0: colour from the depth, foam at the shore) needs no mask, whatever the material: the shader derives it from the height.
- Optional: without the file, ground everywhere; past the heightmap, ground.
- Check it in the panel: Light shafts → Debug view 3 shows each material in a flat colour over the relief (ground grey, metal yellow, gloss blue, spare green): the objects' walls should be covered.

In Houdini (Copernicus): from your `material_index` (ground, metal, gloss, spare), one mask per material, the same blur for all. Grow the objects' masks by about a texel before the blur, so their walls take the object's material: masks are read by xz, and a vertical wall has a single xz, so its whole height takes the material at its foot. Then the gradients, after the blur: multiply the objects' masks by one minus the sand's cover, so they keep adding up to 1 at most and a gem keeps its share of the object (the cover ramping over 16 texels or more to blend fully, or blurred like an edge for a crisp drift). One heightfield layer per material (`metal`, `gloss`, `spare` by default, `LAYERS` at the top of the snippet; a missing one exports empty). The snippet only reads, checks and packs: it refuses layers of different resolutions, over 2048 per side, and a footprint that differs from the exported `heightmap.json`.

## Ground colour: `albedo.png` (optional)

The ground's colour inside the heightmap, from `hou/snippets/python/export_albedo.py`.

- 8-bit **RGB** (no alpha), **display values (sRGB)**: the renderer has no colour management, and the panel's colours are display values too. No gamma or ICC chunk: the values are read as they are. Colour rather than data, so imported as lossy WebP (`?format=webp&quality=90`), a fraction of the lossless size.
- **Albedo only**: no AO, cavity, shadow or light in it (they're in `maps.png`, so they'd count twice). The ground only: metal, gloss and spare take their colours from the panel. Under the sea it's unused (the water's colour comes from its depth).
- Same footprint and orientation as `maps.png`; its own resolution, ≤ 2048 per side: 2048² over the 2 km site (1 m texels). The shader's variation (Ground colours → Variation) adds detail below the texel.
- Rock is painted into it (slope, erosion: in Copernicus): the shader has no rock rule.
- Past the heightmap, the ground is Shading → Tint: match it to the map's edges.
- Graded live in the panel (Ground colours → Albedo saturation, Albedo tint). Keep it near grey for the tone.
- Optional: without the file, Shading → Tint, as past the heightmap.
- Check it in the panel: Light shafts → Debug view 4 shows the ground's colour as the shader uses it, unlit and without fog (colours, orientation: rock on the cliffs).

In Houdini: three heightfield layers, R, G, B (`albedo_r`, `albedo_g`, `albedo_b` by default, `LAYERS` at the top of the snippet), already converted to display values in Copernicus. The snippet only reads, checks and packs, with the same checks as the materials.

## Versioning

- New optional fields or channels in a sidecar file: no version bump.
- Changing the meaning of a channel or field: bump `version`.
- Version 2 (2026-11-01): R is the cast shadow alone. Version 1 baked the light (the sun's angle on the slope × the shadow); the loader refuses it and asks for a re-export.
