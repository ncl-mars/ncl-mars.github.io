# About this site

Key points about the portfolio itself: what it is, how it's made, what was hard. To talk about it, and as a base for its own project card.

```
LINZ lidar + photos ──► Houdini / Copernicus ──► exports ──────────────► SvelteKit, static ──► WebGL2 in the browser
 real terrain, NZ        stamps, de-lighting,     16-bit heights, maps,    every page            one canvas, raymarched
                         baked shadows, AO        albedo, POIs             prerendered           terrain, live atmosphere
```

## In one sentence

A portfolio as a misty archaeological dig site: the projects stand as points on a real landscape, drawn live in the browser, their names tied to the ground by thin survey lines.

## The idea

- The home page is a site survey of an excavation. Each project is a point of interest on the terrain; its label, an HTML callout tied to the ground like on a technical drawing, opens the project's card over the live scene.
- Discovery over the obvious: the landscape is drowned in mist; you turn and zoom to find your way.
- The 3D is only the landscape. Everything you read is HTML: accessible, and every project has its own prerendered page, for links and search engines.

## A real landscape

- LINZ's 1 m lidar elevation model of Canterbury, New Zealand, at half scale: 4 km of ground on the 2 km site (2048² heights), 32 km on a 16 km far map (1024²). The heights are halved too, so the slopes stay true.
- Its colour from LINZ's 0.2 m aerial photos (the site) and 10 m satellite mosaic (the far map), their light taken out in Copernicus, since the web lights the ground itself.
- The projects' objects are stamped into the ground in Houdini (Copernicus heightfields: a smooth merge, some erosion), heading toward half-buried fossils.
- The sun's shadows are baked in Houdini: a soft penumbra that widens with the distance to the occluder (an OpenCL kernel), and ambient occlusion. The browser only adds the sun's angle on each slope.

## Rendering: raw WebGL2, no 3D engine

- One canvas for the whole site, shared by every page: the scene never reloads between the home page and a project.
- The terrain is raymarched, not a mesh, and endless: the heightmap blends into the far map, then into noise, with no visible edge.
- Cached: the costly march runs only when the camera moves; a still frame only recomposes the atmosphere over it.
- The atmosphere, every frame: distance fog, height mist, mist banks drifting with the wind, the sun's glow, light shafts through the mist (from a shadow ceiling rendered once, since the sun and the ground don't move), and water with waves, sky reflection and the sun's glint.
- Colour in linear light, with an AgX tone curve.
- The heights are 16-bit, packed losslessly (a predictor from lossless JPEG-LS, then deflate) to less than half their size, unpacked by the browser's own decompressor.
- Dust: particles without state, each computed in the vertex shader from its number and the time.
- The labels cast shadows: the HTML callouts' lines and text throw shadows into the light shafts and onto the ground (the text drawn into a mask, then raymarched in a box per label).

## Performance

- Reference device: an old, cheap phone (90 Hz screen), target 60 fps.
- It adapts by itself: a device whose moving frames run slow marches a rough terrain while the camera moves (detected once, remembered), the sharp one when it stops; then the resolution follows the frame time.
- The whole site is about 9 MB, the terrain 8.7 of it: heights 3.4 MB, lighting maps 1.5, colour 1.7, far map 1.2 + 0.9.

## Stories worth telling

- **Stairs on steep slopes.** The GPU's texture filtering blends with 8-bit weights, which stepped the heights at grazing angles. Found with a debug view of the ground as contour lines, after two fixes that were right but weren't the cause; fixed by filtering the heights in the shader.
- **Black dashes on the stamps.** The stamps' walls stepped one texel at a time, and each step caught or missed the sun. Found by switching the slope's light off; fixed by reading the heights as a smooth B-spline (4 texture reads, Sigg & Hadwiger's trick) and smoothing the slope.
- **The scene shifting as a card opened.** A hidden heading gave the home page a 15 px scrollbar that a project's page didn't have, so the canvas changed width. Measured in the browser's console, after ruling out two other causes.

## Tools around it

- A live tuning panel for every value (camera, march, light, fog, mist…), saved back to a JSON file; shaders reload live; debug views (the ground as contour lines, its colour unlit, the light shafts alone).
- The Houdini exports are Python SOPs, with a written format contract between Houdini and the web for each file.

## Stack

- SvelteKit 2 and Svelte 5, TypeScript, a static site (every page prerendered), twgl.js for the WebGL2 plumbing, GitHub Pages.
- Houdini 22: SOPs, Copernicus, OpenCL.

## Credits

- Terrain and imagery: "Sourced from the LINZ Data Service and licensed by Toitū Te Whenua Land Information New Zealand, for re-use under CC BY 4.0." The licence requires this credit on the site.
