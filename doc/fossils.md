# Fossils and sediment

The object stamps as fossils: the objects stand proud of the ground where you placed them, weathered, with sand piled against them and settled along the surface by the wind. Made in Copernicus, before the bakes and the exports ([terrain-export.md](terrain-export.md)). Planned on 2026-11-06: only the id map exists so far.

## Principle

- Each effect is its own layer, in metres, and each stage outputs what it adds: **height = base + fossil + sand**. A merged height can't tell later tools why a pixel is high (rock or sand); the layers can, and each can be tuned alone.
- The id, the distance to the outlines and the zone values are coordinates every later kernel and terrain tool reads.
- One diffuse material: rock and sand are colours in the albedo (the materials' removal in the roadmap stands).

## Layers

| Layer | Values | Meaning | Made by |
|---|---|---|---|
| `base` | m | The site's ground, without the objects | `cut_dem.cl`, × 0.5 ([dem.md](dem.md)) |
| `objects` | m | The stamps' heights: P.y, as placed; 0 outside | `rasterize_height_aa`, anti-aliased |
| `objects_full` | m | The same, not anti-aliased, at `alpha`'s resolution: for the emerged outline | `rasterize_full` |
| `alpha` | 0–1 | The stamps' coverage | `rasterize_full`, not anti-aliased |
| `sdf` | m | The distance to the nearest emergence line (where a stamp comes out of the ground), negative on the emerged rock | Mono to SDF (iso 0) of the relief over `base`, × the layer's scale |
| `id` | int | The project's id on every pixel: the nearest stamp's | `extrapolate_ids`, then the id fix |
| `err` | 0/1 | Where the jump failed | `extrapolate_ids` |
| `edge` | m | The nearest stamp's relief just inside its emergence line: its wall's height where it stands proud, near 0 where it comes out gently | `extrapolate_ids` |
| zone layers | per attribute | The stamps' zone attributes, on every pixel | `rasterize_full`, `extrapolate_ids`, the id fix, blurred |
| `fossil` | m | The rock's relief over `base`, weathered | stage 3 |
| `fossil_mask` | 0–1 | The rock's weight in its blend with the ground | stage 3 |
| `apron` | m | Sand against the fossils, before the slump | stage 4 |
| `shelter` | 0–1 | Exposure to the wind: 0 in the lee, 1 exposed | stage 5 |
| `cover` | 0–1 | Sand on the surface, thin cover included | stage 6 |
| `sand` | m | The sand's thickness over `base + fossil`, after the slump | stage 6 |
| `height` | m | `base + fossil + sand`: the exported heights | stage 7 |
| `albedo` | RGB | The photo, then rock, then sand | stage 7 |

## Stages

### 1. Rasterize

- `objects`: P.y rasterized from above (a camera at (0, 1000, 0) looking down, over the 2,000 m cube), so each object sits exactly as placed, partly sunk or not: placing them is the burial. Anti-aliased (`rasterize_height_aa`).
- `alpha`, `project_id`, P.y (`objects_full`) and the zone attributes at full resolution, not anti-aliased (`rasterize_full`).

### 2. Fields

- Metres: one image unit is `length(@sdf.imageToWorld((float2)(1, 0)) - @sdf.imageToWorld((float2)(0, 0)))`, 1000 for the site (the layers' transform), so no kernel needs a size parameter. Directions (sun, wind) are swizzled into image axes (`.zyx`, as in `bake_shadow.cl`).
- The outline is where the rock comes out of the ground, not the stamps' footprint seen from above: the buried parts are underground and shape nothing (no weathering, no sand, no territory). `sdf` is Mono to SDF, iso 0, of the relief over the ground (`objects_full − base`) where `alpha` covers, and of a large negative value elsewhere (−1000: at 0, the sea, flattened at 0, would sit on the iso). The relief rather than a 0/1 mask, so the line falls between pixels where the rock comes out gently; at a wall it's the same step as a mask's. A stamp entirely underground has no emerged part: no outline, and its project drops out of the id map.
- `extrapolate_ids`: one jump per pixel to the nearest emergence line, then every read at the landing point: `id`; `edge` (`objects − base` there, 2 px inside the line, clear of the anti-aliasing: the wall's height where the fossil stands proud, near 0 where it comes out gently); each zone attribute. And `err` where the jump failed: the SDF at the landing point is still positive, it never got onto emerged rock. The jump works in Mono to SDF's image units (it moves `@P`); `sdf` leaves the subnet in metres. The 2 px inset counts in pixels, not image units, so it holds at any resolution: emerged parts can be thin slivers.
- The id fix, a second kernel: a mode filter. Each pixel counts the ids within `radius` and takes the most common one if its own is in the minority or `err` is set, copying its zone values from a neighbour with the winning id. Radius 1 clears the dots and the 1-px lines of a third id; a border moves by at most the radius.
- The zone values blurred across the borders (the values, never the ids), so a value that changes from one zone to the next leaves no seam. The ids' stair-steps are the pixel grid: an id can't be anti-aliased.

### 3. Fossil (one kernel, inside the outlines)

- The objects as placed, proud of the ground. Their top edges round off over `weathering` metres from the outline inward (the inside distance); the walls stay. A noise erosion pits the exposed surface.
- The contact with the ground: a smooth max (`smin_cube_mix` in `hou/lib/ocl/include/smooth_min.cl`, iq's cubic smooth min with its mix factor; k is the contact's fillet).
- Outputs `fossil` (the relief over `base`) and `fossil_mask` (the smooth max's mix factor).

### 4. Apron (one kernel, outside the outlines)

- Sand against each fossil: as high as `edge × climb` at the wall, down to nothing at `reach` metres, along `profile` (straight talus, concave drift). The wall above it stays bare.
- The wind: a short ramp on the windward side, a long tail in the lee (`reach` scaled by `lee`, from the angle between the wind and the SDF's normal, which points away from the fossil).
- Where the rock comes out gently, `edge` is near 0 and so is the sand: aprons build only against walls, with no special case.
- Joined to the ground by a smooth max. The sediment stage slumps it.

### 5. Shelter

- `bake_shadow.cl` toward the wind instead of the sun, at a low angle, on `base + fossil + apron`: 0 in the lee of ridges and fossils, 1 where exposed.

### 6. Sediment (a Block loop, Block End's Iterations, at 2048)

- `cover` (0–1) from the flatness, `shelter` and a noise stretched along the wind (streaks, longer behind obstacles): sand settles on flats and in the lee, bare rock shows on exposed slopes and crests.
- Deposition: where the ground lies below its blurred self (hollows) and the cover is high, part of the gap fills each iteration.
- Slump: sand steeper than its angle of repose (about 32°) slides down. Only sand moves: the rock (`fossil_mask`) and the ground stay.
- Outputs `sand` (the thickness over `base + fossil`: the apron and the deposits, after the slump) and `cover`. Thin cover is colour only.

### 7. Colour and bake

- `height = base + fossil + sand`, then the bakes on it (shadow, AO, cavity: [terrain-export.md](terrain-export.md)).
- The albedo, mixed in linear at 2048: the photo (de-lit on `base`); rock by `fossil_mask` (grey, `rock_tint` for each project's mineral nuance, a noise for veins and strata); sand by `cover` (a tint picked from the photo's own sand, varied by noise, streaked along the wind). The sRGB encode last.

## Zone attributes

Prim attributes on the stamps, rasterized like `project_id` and extrapolated by `extrapolate_ids`: a kernel binds a layer instead of a list of parameters, and any number of zones works. A first set, names to settle:

| Attribute | Meaning |
|---|---|
| `reach` | m: how far the sand slope goes from the fossil |
| `climb` | 0–1: how high the sand rises up the walls |
| `profile` | int: the slope's shape (straight talus, concave drift…) |
| `lee` | How much longer the tail runs downwind |
| `weathering` | m: the top edges' rounding |
| `rock_tint` | RGB: the fossil's mineral nuance |

## Wind

- One prevailing direction, `wind_dir`, in world axes like `sun_dir`, owned by Houdini.
- It shapes the aprons (stage 4), the shelter (5), the cover and its streaks (6).
- Later, in the web: `wind_dir` exported in `maps.json` like `sun_dir` (a format change), so the dust and the mist banks drift the way the sand lies.

## Resolution

- The fossil is merged at the anti-aliasing resolution, as today: merging before the downsample averages the edges with the ground, where a stamp layer downsampled alone averages them with 0. ×2 (4096) or ×4 (8192): compare both downsampled to 2048. 4096 is about the DEM's own resolution (4000).
- Then everything at 2048, the export's resolution: the apron, the shelter, the sediment (its slopes take the cell size in metres from the layer's transform), the colour and the bakes.
- Upsampling the terrain to the anti-aliasing resolution is harmless (smooth heights, averaged back down). The photo is never upsampled: the albedo is mixed at 2048 from the photo averaged down; finer, it would be cut from the 0.2 m source at that size.

## Tracking copies

- Each kernel, once it settles, copied to `hou/snippets/ocl/` with a header (inputs, outputs, parameters), like `bake_shadow.cl`. The node snippet in the `.hip` stays canonical.
- The graph: this doc (layers and stages). Optionally, a Python snippet dumping the COP network (nodes, wiring, parameters off their defaults) to a text file in `hou/` on each save: exact and diffable.

## Today

- `extrapolate_ids` (the kernel, its subnet and the parent subnet): Mono to SDF of the mask; each pixel jumps along the SDF's normal (iq's central differences, `eps` apart) to the nearest outline, `iteration` times, landing 0.002 image units inside (2 px at 2048), and reads `_id` there. Outputs `id` and `sdf` (image units). Left: dots even at high iteration counts, and thin lines of a third id along some borders (the id fix, stage 2).
- `merge_objects`: a smooth max of the stamps and the ground (`smin_cube_mix`), k per zone, with the blend factor. The walls stay, since a smooth max of heights only blends where the two cross: stages 3 and 4 replace it.

## Open questions

- ×2 or ×4 for the merge.
- The zone attributes' names, and modes beyond `profile`.
- The wind's direction, and how the web's dust and mist take it.
- The network dump: wanted?
- Does the web ever need the id map or a mask (a new export and format)? Houdini only for now.

## Order of work

1. Fields: the metres from the layers' transform; `extrapolate_ids` with `err`, `edge` and the zone attributes; the id fix.
2. The fossil kernel, at the merge's resolution (×2 against ×4), checked in the web on the heights alone.
3. The apron kernel (reach, climb, profile, wind), checked in the web.
4. The shelter and the sediment loop.
5. The albedo mix.
6. Bakes and exports; [terrain-export.md](terrain-export.md) and [dem.md](dem.md) § 6 updated; tracking copies of the settled kernels.
7. The web: `wind_dir` in `maps.json`, for the dust and the mist banks.
