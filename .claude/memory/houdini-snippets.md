---
name: houdini-snippets
description: Houdini snippet requests (untracked Temp kernels): write exactly the user's algorithm, minimal; refs from this project (+ BioGrowth), never BrambleJewelry; no docs unless asked
metadata:
  type: feedback
---

When the user asks for a Houdini node snippet (the Temp kernels and wrangles, not tracked), write exactly the algorithm they describe, in as few lines as it takes, keeping their skeleton and names. "iq's normals" means iq's code as is, `eps` and `h = (eps, 0)` included. Write nothing else (docs, memory notes, tracking copies) unless they ask.

**Why:** 2026-11-06, the `sdf_to_ids` COP kernel took an hour ("putain de merde, 1h pour ça"). I over-built the first version (upwind gradients, a neighbourhood search, a band) and detoured through another project's memory and Houdini's help. I also wrote a memory note unasked ("when I ask you things like that, not tracked, in houdini, you don't make doc unless i ask for!"). What worked: when they showed the artefacts and asked "do you see the problem?", naming each artefact's cause and the smallest change ("that was what i needed").

**How to apply:**
- Add no robustness they didn't ask for. If the plain version has a known failure, name it in one line.
- When they ask about a result, tie each cause to what the screenshot shows and give the minimal change in chat. Don't rewrite the file while they're tuning it.
- References: this project's COP kernels (`hou/snippets/ocl/`, `hou/lib/ocl/include/`) and Houdini's `imx.h` ([[cop-opencl]]). If more is needed, BioGrowth (`D:\Spec\BioGrowth`). Never BrambleJewelry's memory, even though the global CLAUDE.md points there.
