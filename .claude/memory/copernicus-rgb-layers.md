---
name: copernicus-rgb-layers
description: A texture with several channels comes from Copernicus as one RGB layer (one volume with 3+ channels in SOPs); exporters read it as is, never one heightfield per channel
metadata:
  type: feedback
---

The user does everything in Copernicus and imports the layers into SOPs only to export them with the Python snippets. A texture with several channels is one RGB layer (in SOPs, one volume with three channels or more), and the exporter reads it as is: `export_albedo.py` (`albedo`, through `rgb_layer()` / `rgb()`).

**Why:** the user was angry when the albedo exporter expected three heightfields (an RGB layer, not three heightfields, no SOP terrain tools), and on 2026-11-05 asked for the same in the materials exporter (removed since, with the materials).

**How to apply:** a new exporter or packed texture takes one RGB layer, never one heightfield per channel. `export_maps.py` still reads three mono layers (`shadow`, `occlusion`, `cavity`, each its own bake): ask before changing it. Relates to [[copernicus-image-ops]].
