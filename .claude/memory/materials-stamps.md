---
name: materials-stamps
description: Material slots are generic (R metal, G gloss, B spare), coloured by albedo.png and blended by the masks; used for some stamps (gold, glossy rock)
metadata:
  type: project
---

The ground's look comes from `albedo.png` / `faralbedo.png` (LINZ imagery). On 2026-11-05 `materials.png` came back for some stamps, and every slot now takes its colour from the albedo (times a tint, white as painted), so the slots are generic surfaces: R metal (gold or silver is paint in the albedo), G gloss, B spare if needed. A glossy rock is the terrain (its grey in the albedo) mixed with G by a partial mask.

**Why:** the user's model is generic materials blended together, with one colour source for the site. They were angry when Claude called R "gold" (the metal's old default colour) and routed the rock's gloss to Spare instead of G.

**How to apply:** talk about the slots generically (metal, gloss, spare), never as gold or rock. Gloss is G, mixed with the terrain through the mask's value. The material code is no longer a removal candidate; don't suggest materials for the ground's own look.
