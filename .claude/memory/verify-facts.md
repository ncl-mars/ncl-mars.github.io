---
name: verify-facts
description: Never state unverified facts (Houdini internals, viewport, tools) as fact; look them up on the web or say it's unknown
metadata:
  type: feedback
---

Don't present a guess as a fact. When an answer depends on how a tool works (Houdini's viewport, Copernicus, a GPU or browser behaviour) and it isn't verified, search the web (SideFX docs, forums) before answering, or say plainly that it's unknown.

**Why:** on 2026-11-12, diagnosing black dashes on the stamp walls, I said Houdini draws heightfields as triangles with smoothed point normals, as a fact; it was a guess. The user: "don't state things you don't know as fact and go fetch them on the web". Same day, I also argued the Houdini comparison was at another resolution when the user had said it was the same: take the user's stated test conditions as given ([[diagnose-first]]).

The same day I told the user "every POI has a card today" without looking: every project.md held only a title, so the change I'd just made turned all the labels into plain text. Facts about the project's own state (content, assets, settings) get checked too, with a Glob or a Read, before they're stated.

**How to apply:** before comparing the web with Houdini's display (or any tool's behaviour), fetch the docs; quote what they say and link them; mark what's still inferred. Before stating what the repo contains, look. Related: [[user-profile]].
