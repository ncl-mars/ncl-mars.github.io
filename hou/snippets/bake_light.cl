// Copernicus OpenCL COP: bakes the `light` layer that export_maps.py writes as R of maps.png: the sun's diffuse
// times its soft cast shadow (the penumbra widens with the distance to the occluder, like a real sun's).
// Format: doc/formats/terrain-maps.md.
// Tracking copy: the node snippet in the .hip is canonical.
//
// Input `height`: altitudes in world units, flattened at the sea first (max(height, 0)), so the shadows land
// on the water's surface. Square image, -1..1 in image space over `size` world units; image +x = world +X,
// image +y = world +Z.
// `sun_dir` points toward the sun, in world axes. In SOPs, the v@sun_dir that export_maps.py reads references
// it (chv), so the web's sun (fog glow, god rays, legend shadows) is the bake's.
// The other two layers come from Copernicus nodes on the same flattened height: occlusion from Height to
// Ambient Occlusion (1 = open sky), cavity from Curvature remapped around 0.5 (crests above).
// Tuning: softness (lower is softer), the march's step growth (d * 0.04: lower if thin ridges miss their
// shadows), the 0.05 bias (higher if flat ground gets speckled).

#bind layer height float
#bind layer !&light float
#bind parm sun_dir  float3 val={-0.8215, 0.4426, 0.3594}
#bind parm size     float  val=1000
#bind parm softness float  val=10

@KERNEL
{
    float3 L = normalize(@sun_dir);              // toward the sun
    float extent = 0.5f * @size;                 // world units per image unit
    float px = 2.0f / @xres;                     // one pixel, in image units
    float cell = @size / @xres;                  // one pixel, in world units
    float2 P = @P;
    float h = @height;

    // Diffuse, from the slope one pixel apart
    float hx = @height.imageSample(P + (float2)(px, 0.0f)) - @height.imageSample(P - (float2)(px, 0.0f));
    float hz = @height.imageSample(P + (float2)(0.0f, px)) - @height.imageSample(P - (float2)(0.0f, px));
    float3 n = normalize((float3)(-hx / (2.0f * cell), 1.0f, -hz / (2.0f * cell)));
    float ndl = fmax(dot(n, L), 0.0f);

    // Cast shadow: march toward the sun until the ray leaves the image; the smallest
    // clearance / distance ratio gives the penumbra
    float2 toward = normalize(L.xz);
    float rise = L.y / length(L.xz);             // the ray's climb per world unit along the ground
    float shadow = 1.0f;
    for (float d = cell; ; d += fmax(cell, d * 0.04f)) {
        float2 q = P + toward * (d / extent);
        if (fabs(q.x) > 1.0f || fabs(q.y) > 1.0f) break;
        float clearance = h + 0.05f + rise * d - @height.imageSample(q);
        if (clearance <= 0.0f) { shadow = 0.0f; break; }
        shadow = fmin(shadow, @softness * clearance / d);
    }
    @light.set(ndl * smoothstep(0.0f, 1.0f, shadow));
}
