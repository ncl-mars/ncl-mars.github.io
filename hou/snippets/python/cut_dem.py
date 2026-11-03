# Shelf tool: cuts the terrain's site and far map out of the DEM tiles, centred where the selected
# cut_dem node's `center` says (hou/snippets/ocl/cut_dem.cl: metres east and north of the field's centre,
# framed on the preview). Writes $HIP/geo/dem/site.tif (1 m) and far.tif (8 m) with tools/dem.mjs, then
# reload their File COPs. The process: doc/dem.md.
# Tracking copy: the shelf tool in Houdini is canonical.

import subprocess

import hou

TILES = r"D:\tmp\lds-new-zealand-lidar-1m-dem-GTiff"  # the DEM download: a folder of GeoTIFF tiles
SCALE = 0.5  # world metres per metre of ground: 4 km of it on the 2 km site
SITE = 2000  # the site's side in the world, metres; the far map's is 8 times that

nodes = hou.selectedNodes()
if not nodes or nodes[0].parmTuple("center") is None:
    raise hou.OperationFailed("Select a cut_dem node: its center is where to cut")
x, y = (round(v) for v in nodes[0].parmTuple("center").eval())
for name, side, step in (("site", SITE / SCALE, 1), ("far", 8 * SITE / SCALE, 8)):
    run = subprocess.run(
        ["node", "tools/dem.mjs", TILES, hou.text.expandString(f"$HIP/geo/dem/{name}.tif"),
         "--offset", str(x), str(y), "--size", str(round(side)), "--step", str(step)],
        cwd=hou.text.expandString("$HIP/.."), capture_output=True, text=True)
    print(run.stdout or run.stderr)
