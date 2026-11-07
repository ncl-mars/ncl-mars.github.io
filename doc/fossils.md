# Fossils and sediment

The object stamps as fossils: the objects stand proud of the ground where you placed them, their edges weathered, with sand slumped against them. The whole terrain gets a subtle erosion too (finer detail, deposits), stronger near the fossils, and an erosion tint over the photo. All in Copernicus with its heightfield nodes (any layer named `height`, its type info set to height), before the bakes and the exports ([terrain-export.md](terrain-export.md)). Planned on 2026-11-06: only the id map exists so far.

## Big picture

```
1 INPUTS   DEM ─► base           objects ─► rasterize ─► objects (P.y) · alpha · project_id

2 FIELDS   objects − base ─► Mono to SDF ─► sdf   (the line where the rock comes out)
           sdf + project_id ─► extrapolate_ids ─► id

3 HEIGHT   base + objects ─► merge_objects ─► Erode ─► Slump ─► height ─► bakes ─► export
                                   │            │        │
                              fossil_mask    debris    sand
                                             sediment
                                             flow

4 COLOUR   photo ─► delight ─► lift darks ─► erosion tint ─► rock ─► sand ─► encode ─► albedo ─► export
```

- Erode: the rock is harder (`fossil_mask` lowers the erodability), so only its edges weather; blended strong near the fossils (`sdf`), subtle elsewhere.
- Slump: its debris input is the sand, put near the fossils (`sdf`), an amount per zone (`id`), more on the lee side; it slides down to about 32° and piles against the walls.
- Colour: the tint from Erode's masks and Mask by Feature; rock where `fossil_mask`, sand where `sand`.

The rest of this doc is the detail behind each box.

## Principle

- The heights go through the nodes in order: merge, erode, slump. Each step leaves its own layer for later tools and kernels: the fossil's mask, the erosion's deposits and flow, the sand's thickness, the feature masks, the zones. A merged height can't tell why a pixel is high (rock or sand); the layers can.
- Built-in heightfield nodes first (HeightField Erode, Slump, Mask by Feature, Strata); kernels only where no node does it.
- The id, the distance to the fossils and the zone values are coordinates every later kernel reads.
- One diffuse material: rock and sand are colours in the albedo (the materials' removal in the roadmap stands).
- The fossils are the focus: the erosion is subtle away from them, the sand only near them.

## Layers

| Layer | Values | Meaning | Made by |
|---|---|---|---|
| `base` | m | The site's ground, without the objects | `cut_dem.cl`, × 0.5 ([dem.md](dem.md)) |
| `objects` | m | The stamps' heights: P.y, as placed; 0 outside | `rasterize_height_aa`, anti-aliased |
| `objects_full` | m | The same, not anti-aliased, at `alpha`'s resolution | `rasterize_full` |
| `alpha` | 0–1 | The stamps' coverage | `rasterize_full`, not anti-aliased |
| `sdf` | m | The distance to the nearest emergence line (where a stamp comes out of the ground), negative on the emerged rock | Mono to SDF (iso 0) of the relief over `base`, × the layer's scale |
| `id` | int | The project's id on every pixel: the nearest emerged stamp's | `extrapolate_ids` |
| zone layers | per attribute | The stamps' zone attributes on every pixel | `rasterize_full`, `extrapolate_ids` |
| `fossil_mask` | 0–1 | The rock's weight in its blend with the ground | `merge_objects` |
| `debris`, `sediment`, `flow` | mono, mono, UV | The erosion's thermal deposits, hydraulic deposits and flow | HeightField Erode |
| `source` | m | Sand to slump: near the fossils, more on the lee side | the sand source kernel |
| `sand` | m | The sand's thickness after the slump | HeightField Slump (its `debris`) |
| feature masks | 0–1 | Slope, curvature, occlusion, direction (the faces turned from the wind) | HeightField Mask by Feature |
| `height` | m | The exported heights | after the slump |
| `albedo` | RGB | The photo toned, tinted by the masks, then rock, then sand | the colour kernel |

## Stages

### 1. Rasterize

- `objects`: P.y rasterized from above (a camera at (0, 1000, 0) looking down, over the 2,000 m cube), so each object sits exactly as placed, partly sunk or not: placing them is the burial. Anti-aliased (`rasterize_height_aa`).
- `alpha`, `project_id`, P.y (`objects_full`) and the zone attributes at full resolution, not anti-aliased (`rasterize_full`).

### 2. Fields

- Metres: one image unit is `length(@sdf.imageToWorld((float2)(1, 0)) - @sdf.imageToWorld((float2)(0, 0)))`, 1000 for the site (the layers' transform), so no kernel needs a size parameter. Directions (sun, wind) are swizzled into image axes (`.zyx`, as in `bake_shadow.cl`).
- The outline is where the rock comes out of the ground, not the stamps' footprint seen from above: the buried parts shape nothing. `sdf` is Mono to SDF, iso 0, of the relief over the ground (`objects_full − base`) where `alpha` covers, and of −1000 elsewhere (at 0 the sea, flattened at 0, would sit on the iso). The relief rather than a 0/1 mask, so the line falls between pixels where the rock comes out gently. A stamp entirely underground has no outline, and its project drops out of the id map.
- `extrapolate_ids`: each pixel jumps along the SDF's normal (iq's central differences) to the nearest emergence line, repeatedly, landing 2 px inside (in pixels, not image units: emerged parts can be thin slivers), and reads `_id` and the zone attributes there. `err` where the jump failed (the SDF at the landing point still positive), to check it. The jump works in Mono to SDF's image units (it moves `@P`); `sdf` leaves the subnet in metres.
- An id fix (a mode filter: each pixel takes the most common id within a radius when its own is in the minority) only if a seam shows near a fossil: far from them, nothing happens per zone.

### 3. Merge

- `merge_objects`: the stamps over the ground by a smooth max (`smin_cube_mix` in `hou/lib/ocl/include/smooth_min.cl`, iq's cubic smooth min with its mix factor; k, the contact's fillet, per zone). Outputs the height and `fossil_mask` (the mix factor).

### 4. Erode

- HeightField Erode on the merged height, at a small Feature Size: at least 2 to 4 m, since detail under about two export pixels averages out at 2048.
- `erodability` from `fossil_mask`: the fossils are harder, so they keep their shape and only their edges weather.
- Blended with the merged height (`blend1`) by a mask: strong near the fossils (`sdf` fading with the distance), subtle everywhere else.
- Its `debris`, `sediment` and `flow` are masks for the colour; its `debris` near the fossils also feeds the sand (their weathered scree).

### 5. Slump (the sand)

- `source`, a small kernel: an amount per zone, fading with `sdf` out to the zone's reach, more on the lee side (the SDF's normal, which points away from the fossil, against `wind_dir`), plus Erode's `debris` near the fossils.
- HeightField Slump with `source` as its `debris`: Repose Angle about 32° (sand), Add Debris to Output Height. The sand slides off the rock and piles against the walls; how far it reaches follows from the amount and the angle. Its `debris` output is `sand`.

### 6. Masks

- HeightField Mask by Feature on the final height: slope (scree, bare rock), curvature (valleys, crests), occlusion (sheltered hollows), direction (Goal Angle from `wind_dir`: the faces turned from the wind).

### 7. Colour and bake

- The bakes on the final height (shadow, AO, cavity: [terrain-export.md](terrain-export.md)).
- The albedo, in linear at 2048, the sRGB encode last:
  1. The photo, de-lit (`delight.cl`, on `base`) and toned (below).
  2. A subtle tint from the masks: sandier in the deposits and on sheltered flats, darker along the flow, greyer on steep rock. Material only, never light: AO and cavity are the web's.
  3. Rock by `fossil_mask`: grey, `rock_tint` for each project's mineral nuance, maybe HeightField Strata's layering if it reads at 1 m per pixel.
  4. Sand by `sand`, fading in over a thickness.

## The photo's darks

The dark parts of the aerial photo (forest, gorges) are too dark: the web multiplies the albedo by the light, so a dark forest on a shaded slope turns black.

- Lift the toe in linear, before the encode: only the darkest values, toward a floor of about 0.04 to 0.05 (real forest albedo is about 0.05 to 0.1); the mids and highs stay.
- By luminance, scaling R, G and B alike, so the hue holds. Cap the gain and desaturate the lifted darks a little, or the forest turns noisy and too green.
- Judged in the web, Debug view 4 (the ground's colour, unlit).

## Zone attributes

Prim attributes on the stamps, rasterized like `project_id` and extrapolated by `extrapolate_ids`: a kernel binds a layer instead of a list of parameters, for any number of zones. A first set, names to settle:

| Attribute | Meaning |
|---|---|
| `k` | m: the contact's fillet in the merge |
| `sand` | m: how much sand the source puts down |
| `reach` | m: how far from the fossil the source goes |
| `lee` | How much more sand on the lee side |
| `erodability` | How much the fossil weathers |
| `rock_tint` | RGB: the fossil's mineral nuance |

Global values first; per zone once the look holds.

## Wind

- One prevailing direction, `wind_dir`, in world axes like `sun_dir`, owned by Houdini.
- It biases the sand source (stage 5) and the direction mask (stage 6).
- Later, in the web: `wind_dir` exported in `maps.json` like `sun_dir` (a format change), so the dust and the mist banks drift the way the sand lies. Until then, matched by hand in the panel.

## Resolution

- The merge at the anti-aliasing resolution, as today: merging before the downsample averages the edges with the ground, where a stamp layer downsampled alone averages them with 0. ×2 (4096) or ×4 (8192): compare both downsampled to 2048. 4096 is about the DEM's own resolution (4000).
- Erode where its Feature Size needs; then 2048 for the slump, the masks, the colour and the bakes.
- Upsampling the terrain is harmless (smooth heights, averaged back down). The photo is never upsampled: the albedo is mixed at 2048 from the photo averaged down.

## Tracking copies

- Each kernel, once it settles, copied to `hou/snippets/ocl/` with a header (inputs, outputs, parameters), like `bake_shadow.cl`. The node snippet in the `.hip` stays canonical.
- The graph: this doc. Optionally, a Python snippet dumping the COP network (nodes, wiring, parameters off their defaults) to a text file in `hou/` on each save.

## Today

- `extrapolate_ids` (the kernel, its subnet and the parent subnet): the jump on the SDF of the whole footprint (Mono to SDF of the mask), `iteration` times, landing 0.002 image units inside. To move onto the emerged outline, with the inset in pixels.
- `merge_objects`: the smooth max, k per zone, with the blend factor.
- `heightfield_erode1` and `blend1` already erode the merged heights a little. The photo goes through `delight`, colour corrections and `site_colour` into `OUT_albedo_site`, after the OCIO encode.

## Open questions

- ×2 or ×4 for the merge.
- The zone attributes' names.
- The wind's direction.
- The network dump: wanted?
- Does the web ever need the id map or a mask (a new export and format)? Houdini only for now.

## Order of work

Each step checked in the web before the next, with global values first:

1. Fields: the emerged `sdf` in metres, `extrapolate_ids` on it.
2. Erode: `erodability` from `fossil_mask`, the blend mask, the Feature Size and strength.
3. The sand: the source kernel, then Slump.
4. The colour: the photo's darks, the erosion tint, rock and sand.
5. The zones and the wind.
6. Bakes and exports; [terrain-export.md](terrain-export.md) and [dem.md](dem.md) § 6 updated; tracking copies of the settled kernels.
7. The web: `wind_dir` in `maps.json`, for the dust and the mist banks.
