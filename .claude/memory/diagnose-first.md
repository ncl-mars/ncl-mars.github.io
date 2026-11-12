---
name: diagnose-first
description: Visual artifacts: build a diagnostic (debug view, data check) before shipping fixes; no blind fixes
metadata:
  type: feedback
---

When a visual artifact shows up (stairs, bands, speckles), find where it comes from before changing code: check the data directly (a script over the exported file) and add a dev debug view that shows the suspect stage on its own (e.g. Light shafts → Debug view 2, the march's ground as contour lines). Then fix that stage.

**Why:** on 2026-10-30, terrain stairs in the legend shadows got two blind fixes in a row (the march's stopping point, the shadow ceiling's precision): both correct, neither the cause. The user called it counterproductive and had said from the start it looked like the height filtering. The debug view found it in one look (hardware bilinear filtering isn't exact; fixed with a manual fp32 bilinear near the ground).

Again on 2026-11-12: a small offset of the scene behind the project card. After one test ruled out the dynamic resolution, I rewrote the isolation (greying in the renderer, backdrop-filter dropped) and wrote the supposed cause into CLAUDE.md and the decision log. It didn't fix it, and the user was furious ("stop editing blindly"). A test that rules out one cause doesn't confirm another.

**How to apply:** for any "it looks wrong" report, first propose the diagnostic (or run the data check), share what it shows, then fix. Never edit code until the cause is confirmed by a measurement, and never on "I'll do X unless you say otherwise": wait for an explicit go. Never write a cause into the docs before it's confirmed. Take the user's own hypothesis seriously; they know rendering. Related: [[user-profile]], [[no-unasked-cleanup]], [[verify-facts]].
