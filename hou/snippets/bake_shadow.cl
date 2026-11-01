// Copernicus OpenCL COP: bakes the `shadow` layer that export_maps.py writes as R of maps.png: 1 where the sun
// reaches the ground, 0 in a cast shadow, with a soft penumbra that widens with the distance to the occluder,
// like a real sun's. The sun's angle on the slope (n·L) isn't baked: the web computes it from the heightmap's
// normal, as sharp as the heights, so the maps can be coarser than the heights.
// Format: doc/formats/terrain-maps.md.
// Tracking copy: the node snippet in the .hip is canonical.
//
// Input `height`: altitudes in world units, flattened at the sea first (max(height, 0)), so the shadows land
// on the water's surface. Square image, -1..1 in image space over `size` world units. Bake it on the heights at
// full resolution, then downsample the result to the maps' resolution: small occluders keep their shadows
// (averaged), which a bake on downsampled heights would miss.
// The COP-to-SOP import transposes the axes: image +x = world +Z, image +y = world +X, so the sun is swizzled
// into image axes (.zyx). (Found by fitting the baked light against the exported heightmap's slopes: unswizzled,
// the bake was lit by the sun with X and Z swapped.)
// `sun_dir` points toward the sun, in world axes. In SOPs, the v@sun_dir that export_maps.py reads references
// it (chv), so the web's sun (its light on the slopes, fog glow, god rays, legend shadows) is the bake's.
// The other two layers come from Copernicus nodes on the same flattened height: occlusion from Height to
// Ambient Occlusion (1 = open sky), cavity from Curvature remapped around 0.5 (crests above).
// Tuning: softness (lower is softer), top (at least the highest ground, world units: lower cuts the shadows
// of the highest ground, higher only costs time), the 0.05 bias (higher if flat ground gets speckled; the
// small dashes on rough ground are real, the micro-relief's shadows under a low sun).

#bind layer height float
#bind layer !&shadow float
#bind parm sun_dir  float3 val={-0.8609, 0.3420, 0.3766}
#bind parm size     float  val=1000
#bind parm softness float  val=10
#bind parm top      float  val=100

@KERNEL
{
    float3 L = normalize(@sun_dir).zyx;          // toward the sun, in image axes (x: world Z, z: world X)
    float extent = 0.5f * @size;                 // world units per image unit
    float cell = @size / @height.xres;           // one pixel of the heights, in world units: the march's step
    float2 P = @P;
    float h = @height;

    // March toward the sun one pixel at a time (steps growing with the distance banded the penumbrae into
    // rings), until the ray leaves the image or even the highest ground couldn't shade it any more; the
    // smallest clearance / distance ratio gives the penumbra
    float2 toward = normalize(L.xz);
    float rise = L.y / length(L.xz);             // the ray's climb per world unit along the ground
    float lit = 1.0f;
    for (float d = cell; ; d += cell) {
        if (h + 0.05f + rise * d - @top >= d / @softness) break;
        float2 q = P + toward * (d / extent);
        if (fabs(q.x) > 1.0f || fabs(q.y) > 1.0f) break;
        float clearance = h + 0.05f + rise * d - @height.imageSample(q);
        if (clearance <= 0.0f) { lit = 0.0f; break; }
        lit = fmin(lit, @softness * clearance / d);
    }
    @shadow.set(smoothstep(0.0f, 1.0f, lit));
}
