# Home page: the dig site

**Status:** revision 4, 2026-10-29 (the core sample and the splat finds are dropped; information is elegant HTML text over the 3D, tied to it by legend lines). Implemented so far: renderer, camera, endless terrain, atmosphere (M1–M2b). Next: legend lines prototype, grid (M2c), squares and hover (M2d), project view (M3, being planned), particles (M8).

The home page is an archaeological excavation, seen the way a site survey sees it. The terrain is a raymarched heightmap drowned in heavy mist. A grid of stakes and cords (*carroyage*) divides the site into squares, and each project sits in one square. The 3D stays the misty landscape; everything you read is HTML over it, connected to places in the scene by thin **legend lines**. Clicking a project square opens its project view (being planned, see **Click: the project view**).

---

## Mood

- **Discovery over obviousness (assumed).** Readability is not immediate on purpose: you search, you dig, you find. Don't "fix" the site by making everything obvious; keep affordances discreet and let the visitor explore.
- Heavy, misty, near-monochrome. The terrain is desaturated, and its value follows distance through the fog, almost like a depth map.
- A fixed, low, raking sun, baked into the terrain maps.
- One wind field moves the cords, the mist and the dust together, so gusts visibly travel across the site.
- Colour is reserved for meaning: the hovered thumbnail, the cords in vivid nylon colours (orange, pink or yellow, to choose), and the project images.
- **Simpler, faster, nicer:** the scene doesn't carry content. Text and images are HTML, laid over the 3D with elegant typography.

## Camera: survey view, pan + zoom

- Oblique, orbiting its target. **Heading (yaw) is free:** right-drag or Alt+drag, two-finger twist, Q / E (A / E on AZERTY); N eases back to north up. DOM labels stay upright whatever the heading. **Pitch follows the zoom:** looking down when zoomed out, tilting up toward the horizon when zoomed in (smoothstep on a log scale, tuned in the panel).
- **Pan:** dragging grabs the actual ground under the pointer (CPU raycast). Limited to the heightmap area (the far field is scenery). A released drag keeps some inertia.
- **Zoom:** distance to the target, clamped. Wheel and trackpad pinch glide smoothly toward the pointer; two-finger pinch is direct; double-click or double-tap zooms in toward that point.
- **Compass** (bottom right): its needle follows the heading; clicking it eases back to north. Released rotations keep a little inertia, like pans.
- **Line of sight:** the camera rises when a ridge would come between it and its target (terrain sampled along the whole target → eye line).
- **Keyboard** (the view takes focus when the page loads, no focus ring): movement keys by physical position, so WASD is ZQSD on AZERTY; arrows pan too; Q / E rotate, N north, `+` / `−` zoom.
- Built in TS with `twgl.m4`. The same matrices go to the raymarcher and to everything rasterized. `camera.revision` moves only on real changes (the terrain cache relies on it).
- Input: the canvas is `pointer-events: none`, so the home page's view element receives pointer and touch events (`touch-action: none`).
- Camera state lives in a module and survives client-side navigation.

## Frame structure

| Step | When | What |
|------|------|------|
| 1. Terrain cache | only when the camera, the view size or a ground setting changes | raymarch → RGBA8 colour + `DEPTH_COMPONENT24` texture, at a render scale |
| 2. Atmosphere composite | every frame | cached colour + depth → world position → fog, height mist, wind banks, sun glow → colour + `gl_FragDepth` |
| 3. Cords, stakes, cord shadows (M2c) | every frame, full resolution | GPU curves, depth-tested, in the same atmosphere |
| 4. Particles (M8) | every frame | additive, depth-tested, in the atmosphere |
| 5. Legend lines and labels | after each rendered frame | HTML + SVG overlay, projected through the camera (`renderer.onFrame()`) |

Page scroll doesn't invalidate the cache: only the blit position changes.

## Terrain

- **Endless, no edges, no thickness.** The heightmap fades into a procedural **far field** (low-frequency value noise) over a band along its edges. The far field's base level is the mean height of the heightmap's edges, and it continues to the horizon, where full fog at the fog end distance dissolves it. The sky is the fog colour with a soft gradient overhead, and the page background is the fog colour too (live from the panel), so nothing ever shows an edge.
- **Surface/shading split.** The surface stage (the raymarch) outputs world position and depth; the shading stage applies the baked maps, square state and thumbnail. Plan B: if the raymarcher misses the performance gate, the surface stage becomes a rasterized displaced grid mesh with the same shading.
- **Raymarch:** rays from `invViewProj`; bounded by the ground's height range and the fog end distance; height-relative steps + binary refinement, behind a strategy hook (max-mip or cone stepping later). Writes depth.
- **Height functions** (shared chunk, mirrored on the CPU by `Ground`):
  - `terrainHeight(p)`: the original surface, used by stakes and cords.
  - `height(p)`: `terrainHeight` plus the hover slab. Used by the raymarcher and the particles.
- **Shading:** the grayscale maps baked in Houdini (light/shadow, AO, cavity), combined with adjustable strengths into a near-gray value. The far field gets plain light from the same `sunDir`, blended across the band. No runtime shadows or AO. Formats: [formats/heightmap.md](formats/heightmap.md), [formats/terrain-maps.md](formats/terrain-maps.md).

## Wind and atmosphere

- **Wind chunk:** `uWindDir` (xz), `uWindSpeed`, `uTime` → `windScroll()`; `gust(xz)` comes with the cords. Used by the mist now, the cords and the dust later.
- **Fog chunk**, one for everything drawn in the scene: distance fog (opaque at the fog end), closed-form height mist (dense low down, pooling in valleys), two-layer wind-scrolled banks, fog brighter toward the sun, sky gradient.

## Grid: stakes and cords

- Grid parameters: origin, cell size, N×M squares. Columns are letters, rows are numbers, so a square is `C4`.
- **Stakes:** at every grid intersection, at `terrainHeight` + an offset. Instanced boxes or cylinders.
- **Cords are GPU curves:**
  - Each cord is one instance of a triangle strip (~8 segments). The vertex shader evaluates the curve from `gl_VertexID` (parameter `s`, side ±1).
  - Constant on-screen width (~1.5 px) with anti-aliased edges. When a cord is thinner than a pixel, it fades out.
  - Segments are clamped against the near plane.
- **Cord curve,** applied in this order:
  1. a straight line between the two stake tops, with a slight sag;
  2. wind: a sideways push perpendicular to the cord, with a `sin(πs)` envelope (still at the stakes), weighted by how much the cord faces the wind, plus a small fast shiver;
  3. rest on bumps: `y = max(y, terrainHeight + radius)`.
- **Cord shadows:** the same displaced curve, projected onto the ground along the sun direction. Drawn with a small depth bias.
- Project squares are marked at rest by their cords (accent colour) and their label. Empty squares keep neutral cords.
- There are no grid lines painted in the terrain shader: the cords are the grid.
- **Labels:** DOM elements projected each frame through `renderer.onFrame()` (plain arithmetic, no layout reads). They are real `<a>` links: accessible, found by the prerender crawler, and the fallback when WebGL2 is missing.

## Square state

- One texel per square (RGBA8), read with `texelFetch`:
  - `r`: thumbnail layer + 1 (0 = no project)
  - `g`: hover, 0→1, animated in TS
  - `b`, `a`: reserved
- Updated with `texSubImage2D` only when something changes; a change invalidates the terrain cache while it animates.
- Each project declares its square in `projects.ts` (`cell: 'C4'`). One project per square.

## Hover: the square becomes a screen

- Picking happens on the CPU (`Ground.raycast`). No GPU readback.
- On hover: the square levels into a flat slab; the thumbnail shows on it in full colour against the gray world, slightly emissive; the square's 4 cords highlight.
- Thumbnails: one `TEXTURE_2D_ARRAY`, one layer per project, all the same size via imagetools.
- Keyboard focus on a project's DOM link triggers the same hover.
- Mobile: the first tap acts as hover, the second tap opens the project.
- Under review: the hover may become a legend line from the square to the project's title instead of the slab and thumbnail.

## Legend lines

HTML text over the 3D, tied to places in the scene by thin lines, like the callouts of a technical drawing or a data visualization.

- **The anchor is in 3D, the label stays put.** Labels sit at stable screen positions (e.g. a column on one side, sorted by height); only the line follows the camera. The text never jitters.
- **One elbow:** a short diagonal from the anchor, then a horizontal shelf the text sits on. Hairline stroke, a small ring or dot as the anchor.
- **Motion:** the line draws itself from the anchor to the label, then the text fades in, slightly staggered. Leaving plays it in reverse.
- **In the atmosphere:** a label whose anchor is deep in the mist fades with the same fog as the scene.
- **Type:** one text face, plus a monospace with tabular figures for coordinates and years; short labels in tracked uppercase.
- **Technique:** one SVG overlay for the lines plus HTML labels, positions projected through the camera in `renderer.onFrame()`; no layout reads. Style values (stroke, elbow, colours, timing) in the tuning panel.

## Click: the project view (being planned)

The core sample is dropped. Agreed so far:

- The project is HTML text and images laid over the 3D, connected to its square by legend lines; the colour images open in the lightbox carousel (`Lightbox.svelte`).
- The canvas lives in the root layout, so a camera move can continue across a real page change to a prerendered `/projects/<slug>/`.
- Direction under consideration: a **survey mode** in a digital datavis style. A scan sweeps out from the square and turns the terrain into data (contour lines, grid, dots; mostly a composite-pass change), with the project's panels anchored in the square.

## Particles (M8)

- **Dig dust:** a burst when a project opens.
- **Ambient dust:** a few particles drifting in the raking light, carried by the wind field.
- Transform feedback. They collide with `height()`, are depth-tested against the terrain, blend additively, in the atmosphere.

## Performance

- Baked light, AO and cavity: no runtime shadows or AO.
- The terrain cache: idle frames cost only the atmosphere composite plus what's drawn on top (cords).
- Render scale for the terrain cache on weak devices; everything else stays at full resolution.
- **M2 gate:** measure on the weak device (roadmap Q4). If the raymarcher misses the target, switch the surface stage to the displaced mesh.

## To decide / tune

- Grid size vs number of projects; what empty squares look like
- Cord colours and amplitude
- Legend lines: style and motion (panel), label layout
- The project view (from your sketches): survey mode or not, light or dark, top-down or oblique, what scrolling does
- No-WebGL2 fallback: a static image + the DOM grid of links, projects as plain HTML pages
