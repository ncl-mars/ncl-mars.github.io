# Python SOP: exports the points of interest for the web site, one point per POI.
# Format: doc/formats/pois.md -> pois.json (id, site, x, z of each point; point order = menu order).
# Tracking copy: the node snippet in the .hip is canonical.
#
# Pass-through (the geometry isn't modified). It writes on every cook: bypass the node when not exporting.
# Each point needs two string attributes:
# - `name`: the POI's id, which is also its project folder (web/src/lib/assets/projects/<name>/) and URL.
#   Lowercase letters, digits and hyphens;
# - `site`: its site (its discipline), written as its menu heading reads ("VFX", "Video mapping"). The
#   menus come in the order of their first point.
# Place the points in the space export_heightmap.py exports the heightfield in. Their height is ignored:
# the site sets each POI on the ground.

import json
import os
import re

import hou

OUT_DIR = hou.text.expandString("$HIP/../web/src/lib/assets/terrain")
ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

geo = hou.pwd().geometry()
for attrib, meaning in (("name", "the POI id"), ("site", "its site, as its menu heading reads")):
    if geo.findPointAttrib(attrib) is None:
        raise hou.NodeError(f"The points need a string attribute '{attrib}' ({meaning})")

pois = []
seen = set()
for point in geo.points():
    poi_id = point.attribValue("name")
    site = point.attribValue("site").strip()
    if not ID.match(poi_id):
        raise hou.NodeError(f"Point {point.number()}: name '{poi_id}' must be lowercase letters, digits and hyphens")
    if not site:
        raise hou.NodeError(f"Point {point.number()}: site is empty (its menu heading, e.g. 'VFX')")
    if poi_id in seen:
        raise hou.NodeError(f"Point {point.number()}: name '{poi_id}' is used twice")
    seen.add(poi_id)
    x, _, z = point.position()
    pois.append({"id": poi_id, "site": site, "x": round(x, 3), "z": round(z, 3)})

if not pois:
    raise hou.NodeError("No points to export")

os.makedirs(OUT_DIR, exist_ok=True)
with open(os.path.join(OUT_DIR, "pois.json"), "w") as f:
    json.dump({"version": 1, "pois": pois}, f, indent="\t")
