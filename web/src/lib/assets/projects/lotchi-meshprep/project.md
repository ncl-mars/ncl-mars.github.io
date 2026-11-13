---
title: Lotchi / Meshprep
credits:
  Studio: Lotchi
  Role: Senior technical artist
  Website: https://www.lotchi.live/fr
  # Year: 20xx
media:
  - lotchi_015.webp: Lotchi show
  - lotchi_001.png: ID map reprojected onto the 3D
  - lotchi_007.png: Choir in 2D5 flavor
  - lotchi_005.png: Default colors for IDs in Copernicus
  - lotchi_008.png: AO map of the choir
  - lotchi_004.png:

---
Lotchi makes projection-mapping shows on churches. Before the 2D artists can paint the light to project, each building has to become a clean mesh: clean UVs, split into the regions the show is written for, from the nave to the ceiling.

I started working with Lotchi by unwrapping the monuments' UVs, the very first brick of the prep-mesh deliverable. Then I generated the deliverable itself, combining the studio's Houdini tool with new tools I had already built. Finally, I rewrote the Houdini pipeline from the ground up.

The new pipeline is built from small modules instead of one large tool. It flattens each part of the monument into 2.5D for the artists to paint on, with interactive ID map reprojection, scan colour reprojection and interactive GPU rasterization in Copernicus, Houdini's compositor.
