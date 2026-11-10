# Terrain export checklist

Everything Houdini exports for the web terrain, in order: the 2 km site (2048²) and the 16 km far map (1024²). The formats: [heightmap.md](formats/heightmap.md), [terrain-maps.md](formats/terrain-maps.md), [pois.md](formats/pois.md). The exporters (`hou/snippets/python/export_*.py`) write into `web/src/lib/assets/terrain/` on every cook: bypass them when not exporting.

## Before

- [ ] The site's heightfield 2,000 m wide, the far map's 16,000 m, both centred on the origin, lying in XZ.
- [ ] Heights in metres, both maps scaled alike (× 0.5 for a DEM at half scale: [dem.md](dem.md)).
- [ ] The water line at 0. Inland, choose it with the panel's Water → Sea level (world metres), subtract it from both maps, then put the slider back to 0. Below 0 is water, and the seabed under it gives its depth.
- [ ] The objects merged into the site at 8K, then box-downsampled to 2048 (a box or a gentle Gaussian, never a sharpening filter).

## Exports, in this order

| | File | Exporter | Layers | Resolution |
|---|---|---|---|---|
| 1 | `heightmap.bin` / `.json` | `export_heightmap.py`, `NAME = "heightmap"` | `height`: the site, with its objects | 2048² |
| 2 | `farmap.bin` / `.json` | `export_heightmap.py`, `NAME = "farmap"` | `height`: the far map, no objects | 1024² |
| 3 | `maps.png` / `.json` | `export_maps.py` | `shadow`, `occlusion`, `cavity`, and `v@sun_dir` | 2048² (1024²: 2 m texels) |
| 4 | `albedo.png` (optional) | `export_albedo.py`, `NAME = "albedo"` | `albedo`: one RGB layer over the site | 2048² |
| 5 | `faralbedo.png` (optional) | `export_albedo.py`, `NAME = "faralbedo"` | `albedo`: one RGB layer over the far map | 1024² |
| 6 | `pois.json` | `export_pois.py` | one point per POI, `s@name` | |

The heightmap goes first and the far map second: the others check their footprint against the `.json` of the heights they lie on. All of them cover the site's 2,000 m, except the far albedo (the far map's 16,000 m), and none goes over 2048 per side.

## Maps (3)

- [ ] Baked on the exported 2048² heights, flattened at the water: `max(height, 0)`.
- [ ] `shadow`: `bake_shadow.cl`, `size` 2000 (the site's width), `top` just above the highest point (objects included). `v@sun_dir` references its `sun_dir` (`chv`).
- [ ] `occlusion`: Height to Ambient Occlusion, reading the heights as 2,000 m across, radius 10 to 20 m (10 to 20 px at 2048²).
- [ ] `cavity`: Curvature at the same scale, remapped around 0.5 (crests above).
- [ ] Below 2048², downsample after the bake, so small occluders keep their shadows.

## Albedo (4)

- [ ] Display values (sRGB), the colour of everything, the stamps included (one matte material); no AO, shadow or light in it.
- [ ] From a photo: its light taken out in linear light (`delight.cl`, at the photo's sun, on the heights before the stamps), then back to sRGB.

## Far albedo (5)

- [ ] Over the far map's 16,000 m, 1024², made like the site's albedo (display values, no light in it).
- [ ] Its colours matched to the site's albedo where they overlap (both cover the site), or the site's edge shows.

## POIs (6)

- [ ] One point per POI on the new ground, `s@name` its project folder's id, inside the site (±1,000).

## In the web

- [ ] Hard reload: with the dev server running, the page can keep the old heights.
- [ ] Check in the panel: Light shafts → Debug view 2 (a line every metre of height: unbroken across the site's edge), 4 (the ground's colour).
- [ ] If the terrain changed: retune what's in metres (camera distances, start view, mist, fog) and reframe the POIs (Copy pose).
