# Home page: the dig site

**Status:** revision 3, 2026-10-28 (the core sample replaces the dive and the page change). Implemented so far: renderer, camera, endless terrain, atmosphere (M1–M2b). Next: grid (M2c), squares and hover (M2d), core sample (M3), splat finds (M5), particles (M8).

The home page is an archaeological excavation, seen the way a site survey sees it. The terrain is a raymarched heightmap drowned in heavy mist. A grid of stakes and cords (*carroyage*) divides the site into squares, and each project sits in one square. Hovering a project square turns it into a screen showing the project's thumbnail. Clicking it **cuts a square core sample out of the ground**: the core lifts out, comes to the foreground and becomes the project viewer, with the dig site still alive behind it. Inside the core, the project's images are strata carved in relief; scrolling digs through them; clicking one shows it in colour. There is no page change.

---

## Mood

- **Discovery over obviousness (assumed).** Readability is not immediate on purpose: you search, you dig, you find. Don't "fix" the site by making everything obvious; keep affordances discreet and let the visitor explore.
- Heavy, misty, near-monochrome. The terrain is desaturated, and its value follows distance through the fog, almost like a depth map.
- A fixed, low, raking sun, baked into the terrain maps.
- One wind field moves the cords, the mist and the dust together, so gusts visibly travel across the site.
- Colour is reserved for meaning: the hovered thumbnail, the cords in vivid nylon colours (orange, pink or yellow, to choose), and the project images in the lightbox. Inside the core, images are mineral relief, not colour.

## Camera: survey view, pan + zoom

- Oblique, orbiting its target. **Heading (yaw) is free:** right-drag or Alt+drag, two-finger twist, Q / E (A / E on AZERTY); N eases back to north up. DOM labels stay upright whatever the heading. **Pitch follows the zoom:** looking down when zoomed out, tilting up toward the horizon when zoomed in (smoothstep on a log scale, tuned in the panel).
- **Pan:** dragging grabs the actual ground under the pointer (CPU raycast). Limited to the heightmap area (the far field is scenery). A released drag keeps some inertia.
- **Zoom:** distance to the target, clamped. Wheel and trackpad pinch glide smoothly toward the pointer; two-finger pinch is direct; double-click or double-tap zooms in toward that point.
- **Compass** (bottom right): its needle follows the heading; clicking it eases back to north. Released rotations keep a little inertia, like pans.
- **Line of sight:** the camera rises when a ridge would come between it and its target (terrain sampled along the whole target → eye line).
- **Keyboard** (the view takes focus when the page loads, no focus ring): movement keys by physical position, so WASD is ZQSD on AZERTY; arrows pan too; Q / E rotate, N north, `+` / `−` zoom.
- Panning never changes the view direction, so splat depth order only changes with zoom (pitch) and rotation (heading). Splats re-sort then, never on pan.
- Built in TS with `twgl.m4`. The same matrices go to the raymarcher and to everything rasterized. `camera.revision` moves only on real changes (the terrain cache relies on it).
- Input: the canvas is `pointer-events: none`, so the home page's view element receives pointer and touch events (`touch-action: none`).
- Camera state lives in a module and survives client-side navigation.

## Frame structure

| Step | When | What |
|------|------|------|
| 1. Terrain cache | only when the camera, the view size or a ground setting changes | raymarch → RGBA8 colour + `DEPTH_COMPONENT24` texture, at a render scale |
| 2. Atmosphere composite | every frame | cached colour + depth → world position → fog, height mist, wind banks, sun glow → colour + `gl_FragDepth` |
| 3. Cords, stakes, cord shadows (M2c) | every frame, full resolution | GPU curves, depth-tested, in the same atmosphere |
| 4. Splat finds (M5) | every frame | transparent pass, depth test without depth writes, in the atmosphere |
| 5. Particles (M8) | every frame | additive, depth-tested, in the atmosphere |
| 6. Core sample (M3) | while a core is out | strata slabs, X-ray layers, drawn last, in front of the scene |

Page scroll doesn't invalidate the cache: only the blit position changes.

## Terrain

- **Endless, no edges, no thickness.** The heightmap fades into a procedural **far field** (low-frequency value noise) over a band along its edges. The far field's base level is the mean height of the heightmap's edges, and it continues to the horizon, where full fog at the fog end distance dissolves it. The sky is the fog colour with a soft gradient overhead, and the page background is the fog colour too (live from the panel), so nothing ever shows an edge.
- **Surface/shading split.** The surface stage (the raymarch) outputs world position and depth; the shading stage applies the baked maps, the core hole's strata, square state and thumbnail. Plan B: if the raymarcher misses the performance gate, the surface stage becomes a rasterized displaced grid mesh with the same shading.
- **Raymarch:** rays from `invViewProj`; bounded by the ground's height range and the fog end distance; height-relative steps + binary refinement, behind a strategy hook (max-mip or cone stepping later). Writes depth.
- **Height functions** (shared chunk, mirrored on the CPU by `Ground`):
  - `terrainHeight(p)`: the original surface, used by stakes and cords.
  - `height(p)`: `terrainHeight` minus the core hole, plus the hover slab. Used by the raymarcher and the particles.
- **Shading:** the grayscale maps baked in Houdini (light/shadow, AO, cavity), combined with adjustable strengths into a near-gray value. The far field gets plain light from the same `sunDir`, blended across the band. No runtime shadows or AO. Formats: [formats/heightmap.md](formats/heightmap.md), [formats/terrain-maps.md](formats/terrain-maps.md).

## Wind and atmosphere

- **Wind chunk:** `uWindDir` (xz), `uWindSpeed`, `uTime` → `windScroll()`; `gust(xz)` comes with the cords. Used by the mist now, the cords and the dust later.
- **Fog chunk**, one for everything drawn in the scene: distance fog (opaque at the fog end), closed-form height mist (dense low down, pooling in valleys and in the core hole), two-layer wind-scrolled banks, fog brighter toward the sun, sky gradient.

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
- A cored square keeps its cords stretched across the hole, because the corner stakes stay on undug ground.
- **Cord shadows:** the same displaced curve, projected onto the ground along the sun direction. Drawn with a small depth bias.
- Project squares are marked at rest by their cords (accent colour) and their label. Empty squares keep neutral cords.
- There are no grid lines painted in the terrain shader: the cords are the grid.
- **Labels:** DOM elements projected each frame through `renderer.onFrame()` (plain arithmetic, no layout reads). They are real `<a>` links: accessible, found by the prerender crawler, and the fallback when WebGL2 is missing.

## Square state

- One texel per square (RGBA8), read with `texelFetch`:
  - `r`: thumbnail layer + 1 (0 = no project)
  - `g`: hover, 0→1, animated in TS
  - `b`: core extraction, 0→1 (the hole opens as the core lifts)
  - `a`: reserved
- Updated with `texSubImage2D` only when something changes; a change invalidates the terrain cache while it animates.
- Each project declares its square in `projects.ts` (`cell: 'C4'`). One project per square.

## Hover: the square becomes a screen

- Picking happens on the CPU (`Ground.raycast`). No GPU readback.
- On hover: the square levels into a flat slab; the thumbnail shows on it in full colour against the gray world, slightly emissive; the square's 4 cords highlight.
- Thumbnails: one `TEXTURE_2D_ARRAY`, one layer per project, all the same size via imagetools.
- Keyboard focus on a project's DOM link triggers the same hover.
- On hover, the project's relief maps start loading.
- Mobile: the first tap acts as hover, the second tap opens the core.

## Click: the core sample

1. **Cut:** the ground is cut along the square. The hole is `height()` dropping to the core's depth with vertical walls (the march's binary search finds a vertical wall fine); the walls show procedural strata, the mist pools in it.
2. **Extract:** the core (a square prism: the terrain surface patch on top, strata on its sides) lifts out of the hole, turns toward the camera and grows until it stands in the foreground. One model matrix animated in TS; dust bursts out (M8). The camera doesn't move.
3. **X-ray:** reaching the foreground, the core turns into the viewer (see **Core viewer**). The dig site stays live behind it, with a little more fog to separate the planes; with the camera still, the terrain comes from the cache, so it costs almost nothing.
4. **URL:** SvelteKit shallow routing sets `/projects/<slug>` without leaving the home page. Back closes the core; a shared link opens the site with that core already out. Each `/projects/<slug>` is also prerendered (home + core open) for deep links and search engines.
5. **Close** (×, Escape, click outside, back): the reverse. The viewer collapses into the core, which turns, shrinks and drops back into its hole; the ground closes.

## Core viewer

- **Dipping strata.** Inside the square core, the project's images are layers: subdivided planes tilted at a dip angle (around 15–25°, varying a little per layer), larger than the core and clipped to its square, so its sides show the layers as tilted bands. Earth layers between them get procedural strata shading.
- **Images as relief, not colour.** Each image comes with a **depth map**, made in Houdini (a render's real depth pass, or ML depth estimation), ComfyUI as a fallback. Format: [formats/relief.md](formats/relief.md). The depth map **displaces its stratum** in the vertex shader, so the photo appears as a relief carved in the mineral, lit by a raking light, in grays. The relief fades out toward the layer's edges with an irregular mineral margin: an imprint, never cropped.
- **X-ray look.** The core is translucent: bright edges, faint strata bands, the relief layers glowing like radiograph films (additive, so no transparency sorting). The layer at the reading position **develops**: opaque, fully lit relief.
- **Scrolling digs.** Scroll moves the reading position down or up through the stack, layer by layer. It's the real page scroll (a tall invisible container in the overlay), so touch inertia, keyboard and scrollbar come for free; the scroll position drives the depth.
- **Text outside the core,** in HTML beside it: title, description, credits.
- **Click a layer → the colour image** in an HTML lightbox (`<enhanced:img>`, AVIF/WebP at the right size); Escape or click closes, arrows go to the next / previous image.
- **Hit areas** are HTML elements laid over each layer's image face with a CSS `matrix3d` updated every frame (`renderer.onFrame()`), so clicks, keyboard focus and screen readers work on the 3D layers.
- Relief maps load only when a core opens (or on hover); the colour images only for the lightbox.

## Splat finds (M5)

- Small splat scenes: a find inside the core or at the bottom of the hole, tools, rocks, a hero object per project.
- Composited against the terrain depth (transparent pass), in the atmosphere.
- Re-sorted only when the zoom (pitch) or the heading changes, never on pan.

## Particles (M8)

- **Dig dust:** a burst when a core is cut and lifted.
- **Ambient dust:** a few particles drifting in the raking light, carried by the wind field.
- Transform feedback. They collide with `height()` (hole included), are depth-tested against the terrain, blend additively, in the atmosphere.

## Performance

- Baked light, AO and cavity: no runtime shadows or AO.
- The terrain cache: idle frames cost only the atmosphere composite plus what's drawn on top (cords, core).
- Render scale for the terrain cache on weak devices; everything else stays at full resolution.
- **M2 gate:** measure on the weak device (roadmap Q4). If the raymarcher misses the target, switch the surface stage to the displaced mesh.

## To decide / tune

- Grid size vs number of projects; what empty squares look like
- Cord colours and amplitude
- Core: extraction timing and easing; core size in the foreground; dip angles; relief amplitude; X-ray look; whether hovering a layer hints at its colour
- Whether a splat find lives in the core or in the hole
- No-WebGL2 fallback: a static image + the DOM grid of links, projects as plain HTML pages
