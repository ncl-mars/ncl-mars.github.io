# Home page: the dig site

**Status:** agreed 2026-10-27, revision 2. Implemented in M1/M2 (renderer, terrain, mist, cords, hover, enter), M5 (splat finds), M7 (transition polish) and M8 (particles).

The home page is an archaeological excavation, seen the way a site survey sees it. The terrain is a raymarched heightmap drowned in heavy mist. A grid of stakes and cords (*carroyage*) divides the site into squares, and each project sits in one square. Hovering a project square turns it into a screen showing the project's thumbnail. Clicking it sends the camera down into the square, which becomes the page change.

---

## Mood

- Heavy, misty, near-monochrome. The terrain is desaturated, and its value follows distance through the fog, almost like a depth map.
- A fixed, low, raking sun, baked into the terrain maps.
- One wind field moves the cords, the mist and the dust together, so gusts visibly travel across the site.
- Colour is reserved for meaning: the hovered thumbnail in full colour, and the cords in vivid nylon colours (orange, pink or yellow, to choose).

## Camera: survey view, pan + zoom

- Oblique, orbiting its target. **Heading (yaw) is free:** right-drag or Alt+drag, two-finger twist, Q / E (A / E on AZERTY); N eases back to north up. DOM labels stay upright whatever the heading. **Pitch follows the zoom:** about 60° looking down when zoomed out, tilting up to about 25° toward the horizon when zoomed in (smoothstep on a log scale, to tune). An optional parallax tilt can follow the mouse.
- **Pan:** dragging grabs the actual ground under the pointer (CPU raycast). Limited to the terrain bounds (the fog hides the edges). A released drag keeps some inertia.
- **Zoom:** distance to the target, clamped. Wheel and trackpad pinch glide smoothly toward the pointer; two-finger pinch is direct; double-click or double-tap zooms in toward that point.
- **Compass** (bottom right): its needle follows the heading; clicking it eases back to north. Released rotations keep a little inertia, like pans.
- **Line of sight:** the camera rises when a ridge would come between it and its target (terrain sampled along the whole target → eye line).
- **Keyboard** (the view takes focus when the page loads, no focus ring): movement keys by physical position, so WASD is ZQSD on AZERTY; arrows pan too; Q / E rotate, N north, `+` / `−` zoom.
- Panning never changes the view direction, so splat depth order only changes with zoom (pitch), rotation (heading) and the dive. Splats re-sort then, never on pan.
- Built in TS with `twgl.m4` (`lookAt` → `inverse` = view, `perspective` with the **view rect's** aspect). The same matrices (`view`, `proj`, `viewProj`, `invViewProj`, `camPos`) go to the raymarcher and to everything rasterized.
- The camera never goes through the terrain (it checks the CPU height under the camera).
- Input: the canvas is `pointer-events: none`, so the home page's view element receives pointer and touch events (`touch-action: none`).
- Camera state lives in a module and survives client-side navigation. SvelteKit `snapshot` covers back/forward.

## Frame structure

| Step | When | What |
|------|------|------|
| 1. Terrain cache | only when the camera moves, a square animates or the view resizes | raymarch → FBO: grayscale colour (RGBA8) + `DEPTH_COMPONENT24` texture, at a render scale of 0.5–1 |
| 2. Mist composite | every frame | read cached colour + depth → world position → animated height fog → write colour + `gl_FragDepth` into the view |
| 3. Cords, stakes, cord shadows | every frame, full resolution | GPU curves, depth-tested, fogged in their own shader |
| 4. Splat finds (M5) | every frame | transparent pass, depth test without depth writes, fogged |
| 5. Particles (M8) | every frame | additive, depth-tested, fogged |

Page scroll doesn't invalidate the cache: only the blit position changes.

## Terrain

- **Surface/shading split.** The surface stage (the raymarch) outputs world position, normal and depth. The shading stage (shared chunk) applies the baked maps, pits, square state and thumbnail. Plan B: if the raymarcher misses the performance gate, the surface stage becomes a rasterized displaced grid mesh with the same shading, possibly chosen per device.
- **Raymarch:**
  - Rays come from `invViewProj` (a full-screen triangle; the viewport maps it onto the view rect).
  - The march only covers the part of the ray inside the terrain's box.
  - Height-relative steps (big far above the ground, small near it, at least the pixel footprint) + binary refinement, behind a strategy hook (max-mip or cone stepping later). Steep rays converge in a few steps, and the grazing rays of the zoomed-in, tilted-up camera stay accurate.
  - The hit writes depth with `viewProj`.
- **Height functions** (shared chunk):
  - `terrainHeight(p)`: the original surface, used by stakes and cords.
  - `height(p)`: `terrainHeight` minus the pits, plus the hover slab. Used by the raymarcher and the particles.
- **Shading:** the grayscale maps baked in Houdini (light/shadow, AO, cavity) are combined with adjustable strengths into a near-gray value, with maybe a very slight cool tint. There are no runtime shadows or AO. Format: [formats/terrain-maps.md](formats/terrain-maps.md). The heightmap format is in [formats/heightmap.md](formats/heightmap.md).
- **Pits** are shaded procedurally in grays: strata bands, the same sun direction as the bake, darker with depth.

## Wind and mist

- **Wind chunk:** `uWindDir` (xz), `uWindSpeed`, `uTime` → `windScroll()` and `gust(xz)` (world-space noise scrolled by the wind). Used by the cords, the mist and the particles.
- **Height fog:** density `a·exp(−b·y)`, integrated along the ray in closed form. Rays always point downward, so `rd.y < 0`. The mist pools in valleys and dug pits.
- **Drifting banks:** the density is modulated by 2–3 noise octaves scrolled by `windScroll()`, sampled at the hit point and at one mid-point.
- The fog colour is brighter toward the sun.
- Heavy fog plus the pan limits hide the world edges.
- **One `fog` chunk for everything:** the terrain (in the mist pass), cords, stakes and shadows, splats (fog evaluated at each splat's centre) and particles. Otherwise rasterized things look pasted on top of the mist.

## Grid: stakes and cords

- Grid parameters: origin, cell size, N×M squares. Columns are letters, rows are numbers, so a square is `C4`.
- **Stakes:** at every grid intersection, at `terrainHeight` + an offset. Instanced boxes or cylinders.
- **Cords are GPU curves:**
  - Each cord is one instance of a triangle strip (~8 segments). The vertex shader evaluates the curve from `gl_VertexID` (parameter `s`, side ±1).
  - Constant on-screen width (~1.5 px) with anti-aliased edges. When a cord is thinner than a pixel, it fades out.
  - Segments are clamped against the near plane, which matters during the dive.
- **Cord curve,** applied in this order:
  1. a straight line between the two stake tops, with a slight sag;
  2. wind: a sideways push perpendicular to the cord, with a `sin(πs)` envelope (still at the stakes), weighted by how much the cord faces the wind, plus a small fast shiver;
  3. rest on bumps: `y = max(y, terrainHeight + radius)`.
- Dug squares keep their cords stretched across the pit, because the corner stakes stay on undug ground.
- **Cord shadows:** the same displaced curve, projected onto the ground along the sun direction. Drawn with a small depth bias.
- Project squares are marked at rest by their cords (accent colour) and their label. Empty squares keep neutral cords.
- There are no grid lines painted in the terrain shader: the cords are the grid.
- **Labels:** DOM elements projected each frame (plain arithmetic, no layout reads). They are real `<a>` links: accessible, found by the prerender crawler, and the fallback when WebGL2 is missing.
- Later, the same renderer can draw Houdini curves (`.bin` + `.json`), or verlet cords simulated with transform feedback (M8).

## Square state

- One texel per square (RGBA8), read with `texelFetch`:
  - `r`: thumbnail layer + 1 (0 = no project)
  - `g`: hover, 0→1, animated in TS
  - `b`: dig progress, 0→1
  - `a`: reserved
- Updated with `texSubImage2D` only when something changes. A change invalidates the terrain cache while it animates.
- Each project declares its square in `projects.ts` (`cell: 'C4'`). One project per square.

## Hover: the square becomes a screen

- Picking happens on the CPU: a ray from the pointer is marched through the CPU copy of the heightmap with the same algorithm as the GLSL. No GPU readback.
- On hover:
  - the square levels into a flat slab (`height()` blends toward a per-square plate height precomputed on the CPU at load);
  - the thumbnail shows on the slab, in full colour against the gray world, slightly emissive;
  - the square's 4 cords highlight.
- Thumbnails: one `TEXTURE_2D_ARRAY`, one layer per project, all the same size via imagetools (`?w=512&h=512&fit=cover&format=webp`).
- Keyboard focus on a project's DOM link triggers the same hover.
- On hover, `preloadData('/projects/<slug>')` and the hero image start loading.
- Mobile: the first tap acts as hover, the second tap enters.

## Click: enter the square → page change

1. Input is disabled.
2. The camera eases from oblique to top-down while descending between the cords into the square, and its heading eases back to north, so the thumbnail (and the project's hero image after it) lands upright. The terrain is re-marched every frame and splats re-sort during it. At the same time the dig progress animates 0→1: the pit walls with their strata rise around the camera, the find is revealed, and dust bursts out.
3. The final frame is the thumbnail filling the view. Then `goto('/projects/<slug>')`. The project page opens with the same image as its hero, in the same place. The canvas persists, so the hand-off is seamless.
4. Back: the camera state is still in memory, and the rise out of the square plays in reverse.

## The pit

- Analytic, inside `height()`: terrain minus the pit of the current square, scaled by its dig progress. No texture is modified.
- Pit walls are sloped or stepped (benches), not vertical: vertical walls in a heightfield cause stair-stepping with fixed-step marching.

## Splat finds (M5)

- Small splat scenes: the find at the bottom of a dug square, tools, rocks, a hero object per project.
- Composited against the terrain depth (transparent pass), fogged per splat.
- Re-sorted only when the zoom (pitch) changes and during the dive, never on pan.

## Particles (M8)

- **Dig dust:** a burst when a square is entered and dug.
- **Ambient dust:** a few particles drifting in the raking light, carried by the wind field.
- Transform feedback. They collide with `height()` (pits included), are depth-tested against the terrain, blend additively and are fogged.

## Performance

- Baked light, AO and cavity: no runtime shadows or AO.
- Steep rays and the height slab keep the march short.
- The terrain cache means idle frames cost only the mist pass plus the cords.
- The terrain cache can render at 0.5–0.75 scale on weak devices, while cords stay at full resolution.
- **M2 gate:** measure on the weak device (roadmap Q4). If the raymarcher misses the target, switch the surface stage to the displaced mesh.

## To decide / tune

- Grid size vs number of projects; what empty squares look like
- Pitch and zoom limits; parallax tilt or not; dive duration and easing
- Cord colours, cord amplitude, wind speed and direction
- Fog density, falloff and tint
- How the find and the thumbnail share the pit floor
- Thumbnail size
- No-WebGL2 fallback: a static image + the DOM grid of links
