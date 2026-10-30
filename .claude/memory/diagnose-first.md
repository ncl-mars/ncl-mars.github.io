---
name: diagnose-first
description: Visual artifacts: build a diagnostic (debug view, data check) before shipping fixes; no blind fixes
metadata:
  type: feedback
---

When a visual artifact shows up (stairs, bands, speckles), find where it comes from before changing code: check the data directly (a script over the exported file) and add a dev debug view that shows the suspect stage on its own (e.g. Light shafts → Debug view 2, the march's ground as contour lines). Then fix that stage.

**Why:** on 2026-10-30, terrain stairs in the legend shadows got two blind fixes in a row (the march's stopping point, the shadow ceiling's precision): both correct, neither the cause. The user called it counterproductive and had said from the start it looked like the height filtering. The debug view found it in one look (hardware bilinear filtering isn't exact; fixed with a manual fp32 bilinear near the ground).

**How to apply:** for any "it looks wrong" report, first propose the diagnostic (or run the data check), share what it shows, then fix. Take the user's own hypothesis seriously; they know rendering. Related: [[user-profile]].
