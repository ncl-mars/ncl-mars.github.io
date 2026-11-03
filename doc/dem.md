# Real terrain from a DEM

The site and the far map from a real elevation model: LINZ's 1 m lidar DEM (New Zealand). Three scripts:

- `tools/dem.mjs`: cuts squares out of the DEM's tiles (Node, nothing to install).
- `hou/snippets/ocl/cut_dem.cl`: Copernicus OpenCL COP. Frames a square on the preview, and resamples the cuts.
- `hou/snippets/python/cut_dem.py`: shelf tool. Runs both cuts at the framed centre.

## Scale

The web's site is 2 km (`heightmap`, 2048²), its far map 16 km (`farmap`, 1024²). The ground goes in at half its size: 4 km of it on the site, 32 km on the far map, the heights halved too, so the slopes stay true. The objects keep the detail of a 2 km site: it depends on the site, not on the ground. Another scale: `SCALE` in `cut_dem.py`, and a download that holds the far map (8 times the site's ground).

## 1. Download

- [LINZ Data Service](https://data.linz.govt.nz) (free account): **New Zealand LiDAR 1m DEM** (layer 121859). On a coast, **New Zealand Coastal LiDAR 1m DEM** (122508) has the seabed down to about 25 m.
- Crop a box larger than the far map (32 km at half scale: about 40 km square). GeoTIFF, EPSG:2193 (NZTM).
- Unzip into a folder of its own, outside the project (several GB), and point `TILES` in `cut_dem.py` at it.
- The tiles are LINZ's 1:50,000 sheets. Their `.tab` and `.tfw` repeat each tile's position for other software (not needed); the `.txt` holds the licence and the crop.

## 2. Preview

```
node tools/dem.mjs <tiles> hou/geo/dem/field.tif --step 8
```

The largest square around the field's centre, at 8 m: about a minute and a half for 7 GB of tiles. It prints the field, its centre, and the square's side (the kernel's `src_size`). Copernicus can't open a whole tile (a 24 × 36 km sheet is 3.5 GB in one image, 36,000 px tall: it crashed), so it only ever gets the preview and the cuts.

## 3. Frame (Copernicus)

A File COP on `field.tif`, into two `cut_dem.cl` nodes:

| | `size` | `src_size` | `src_center` |
|---|---|---|---|
| Far map | 32000 | the preview's side | 0, 0 |
| Site | 4000 | the preview's side | 0, 0 |

`center` on one, referenced from the other: metres east and north of the field's centre. Move it until the framing works, keeping the far square inside the field (`center` within half the preview's side minus 16,000, on both axes).

## 4. Cut

Select one of the two nodes and run the shelf tool (`cut_dem.py`): it writes `$HIP/geo/dem/site.tif` (4,000 px of 1 m) and `far.tif` (4,000 px of 8 m). Reload their File COPs. By hand, from the project folder:

```
node tools/dem.mjs <tiles> hou/geo/dem/site.tif --offset X Y --size 4000
node tools/dem.mjs <tiles> hou/geo/dem/far.tif --offset X Y --size 32000 --step 8
```

The tool prints the centre in NZTM (for the credits) and any missing data (-9999: move the square).

## 5. Resample and scale (Copernicus)

- Each cut into a `cut_dem.cl`, `center` and `src_center` at 0, 0: the site with `src_size` and `size` 4000, output 2048 (each pixel a 2 × 2 average); the far map with 32000, output 1024 (4 × 4).
- Both heights × 0.5, the scale.
- To SOPs: the site's heightfield 2,000 m wide, the far map's 16,000 m, both centred on the origin.

## 6. Stamp, bake, export

- Stamp the objects on the site: at their own heights, on the halved ground.
- `bake_shadow.cl`: `size` 2000, `top` just above the site's highest point.
- Export the site first (`export_heightmap.py`, `NAME = "heightmap"`: the other exporters check their footprint against it), then the far map (`NAME = "farmap"`, no objects), then `export_maps.py`, `export_albedo.py` and `export_materials.py` if used, and `export_pois.py`.
- In the web: retune the start view, the POI framings and anything tuned in metres, on the new ground.

## Credits

The download's `.txt` has the line: "Sourced from the LINZ Data Service and licensed by Toitū Te Whenua Land Information New Zealand, for re-use under CC BY 4.0."

## Limits

- `tools/dem.mjs` reads one band of 32-bit floats, uncompressed, LZW or Deflate (predictor 1 or 3), tiled or in strips: what LDS exports. Not LERC (the copies on AWS).
- In the DEM, lakes and large rivers are flattened and bridges removed. In the web, water is only below altitude 0.
