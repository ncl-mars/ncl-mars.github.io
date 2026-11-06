# Fossils and sediment

The object stamps as fossils: rock in the ground, partly exposed and weathered, with sediment gathered against them and along the surface, gentle slopes instead of walls. Made in Copernicus, before the bakes and the exports ([terrain-export.md](terrain-export.md)). Planned on 2026-11-06: the open questions at the end decide parts of it.

## Principle

- Each effect is its own layer, in metres, added up at the end: **height = base + fossil + sediment**. A merged height can't tell later tools why a pixel is high (rock or sand); the layers can, and each can be tuned or remixed alone.
- The id and the distance to the outlines are coordinates every later kernel and terrain tool reads: per-zone looks and parameters, anything shaped by the distance to a fossil.

## Layers

| Layer | Values | Meaning | Made by |
|---|---|---|---|
| `base` | m | The site's ground, without the objects | `cut_dem.cl`, × 0.5 ([dem.md](dem.md)) |
| `objects` | m | The stamps' heights, absolute and anti-aliased; 0 outside | `rasterize_height_aa` (`cam_AA`) |
| `alpha` | 0–1 | The stamps' coverage at full resolution, not anti-aliased | `rasterize_full` (`cam_full`) |
| `id` | int | The project's id on every pixel: the nearest stamp's (territories) | `project_id` from `rasterize_full`, extrapolated (`extrapolate_ids`) |
| `sdf` | m | The distance to the nearest outline, negative inside | Mono to SDF of `alpha` (image units), × size / 2 |
| `fossil` | m | The fossil's relief over `base`, buried and weathered | stage 2 |
| `fossil_mask` | 0–1 | The fossil's weight in its blend with the ground | stage 2 |
| `sediment` | m | The sediment's thickness | stage 3 |
| `height` | m | `base + fossil + sediment`: the exported heights | stage 4 |

`id` covers every pixel so a per-zone parameter exists wherever a kernel works, around the stamps too. 0 is the ground in `project_id`; no pixel keeps it after the extrapolation.

## Stages

1. **Fields**, once: `sdf` in metres (Mono to SDF gives image units: × size / 2, size 2000 for the site), `id`, and the stamps' relief over the ground (`objects − base`).
2. **Fossil**, one kernel, inside the outlines only: bury the stamp by a depth; weather it (its relief fades to 0 at the outline over a width, from the inside distance, so it rises out of the ground instead of standing on a wall); then a smooth max with the ground (`smin_cube_mix` in `hou/lib/ocl/include/smooth_min.cl`, iq's cubic smooth min with its mix factor; k is the contact's fillet). Outputs `fossil` and `fossil_mask` (the mix factor). Inside only, so nothing needs extrapolating.
3. **Sediment**, iterative over the whole site, in a Block loop (Block End's Iterations):
   - Slump: anything steeper than the angle of repose slides down. The fossils are hard rock: `fossil_mask` holds them.
   - Deposition: where the ground lies below its blurred self (hollows, the foot of each fossil), part of the gap fills.
   - Output: `sediment`, the height after minus before. The drifts against the fossils and along the surface come from the same pass, and buried edges, steps left by the anti-aliasing and concave spots need no special case.
4. **Compose and bake**: `height`, then the bakes on it (shadow, AO, cavity: [terrain-export.md](terrain-export.md)); the albedo from the photo (de-lit on `base`), the fossils' colour by `fossil_mask`, sand by `sediment`.

## Per-zone parameters

- Five zones: a lookup by `id` in each kernel, one parameter per zone (as `merge_objects` does for k).
- More zones or more parameters: attributes on the stamps (burial, weathering, sediment), rasterized and extrapolated like the ids, read per pixel. Any number of zones, tuned per object in SOPs.

## Today

- `extrapolate_ids` (the `sdf_to_ids` kernel): each pixel jumps along the SDF's normal (iq's central differences) to the nearest outline, repeatedly, and reads `project_id` just inside. More iterations clear the speckles on the ridges; thin lines of a third id remain along some borders (one-sided differences would fix them).
- `merge_objects`: a smooth max of the stamps and the ground, k per zone, with the blend factor. The walls stay, since a smooth max of heights only blends where the two cross: stage 2 replaces it.

## Open questions

- Do the fossils stand proud of the sediment (harder rock, left standing by erosion), or lie sunken in it (imprints)?
- Sediment by gravity only (slopes and hollows), or wind too (drifts on the lee side, along the web's wind)?
- Does sediment cover the fossils in places (sand over the rock)?
- The merge's resolution: 8K then box-downsampled to 2048, as today (decision log, 2026-11-01), or 2048 once the sediment has softened the walls?

## Order of work

1. `sdf` in metres beside `id`.
2. The fossil kernel, checked in the web on the heights alone.
3. The sediment loop: slump, then hollows, then wind if wanted.
4. The albedo from the masks, and the bakes on the final heights.
5. Once it's built: [terrain-export.md](terrain-export.md) and [dem.md](dem.md) § 6 (the stamping) updated.
