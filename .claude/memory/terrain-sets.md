---
name: terrain-sets
description: Saved terrain sets live outside git in hou/geo/terrains/<name>/ (web exports, tuning, .hiplc, DEM cuts, colour imagery); switch by copying back
metadata:
  type: project
---

Terrain sets the user wants to keep (but not commit) are copied to `hou/geo/terrains/<name>/` (gitignored through `hou/geo/`):

- `web/`: everything in `web/src/lib/assets/terrain/` plus `web/src/lib/tuning/defaults.json` (its camera, mist and fog are tuned to that terrain)
- `gen_maps.hiplc`: the Houdini chain at that point
- `dem/`: the DEM cuts from `hou/geo/dem/` (`field.tif`, `site.tif`, `far.tif`)
- `imagery/`: the colour cuts over the same squares from `hou/geo/imagery/` (`site-aerial.png` 2048², `far-satellite.png` 1024²: LINZ aerial photos and satellite mosaic, photo light still in them). Kept apart from `dem/`: elevation and colour are separate sources

First set: `canterbury` (2026-11-03), LINZ 1 m DEM at half scale, 2 km site centred NZTM 1,513,011 / 5,214,146, 16 km far map; the tiles are in `D:\tmp\lds-new-zealand-lidar-1m-dem-GTiff`.

**Why:** the user tries several real terrains. The one in use is committed as usual (`git add -A`, exports and `.hiplc` included); the others are kept as copies in `hou/geo/terrains/`, outside git, like the DEM data (hundreds of MB), which never goes in ([[commit-workflow]]).

**How to apply:** to switch, copy a set's `web/` files back into `web/src/lib/assets/terrain/` (and `defaults.json` into `web/src/lib/tuning/`), then hard reload ([[dev-stale-terrain]]). Save the current set first if it isn't saved yet.
