// Copernicus OpenCL COP: takes the light out of an aerial photo for albedo.png. Divides it by the slopes'
// shading under the photo's own sun: that baked light fights the web's, which lights the ground itself.
// Format: doc/formats/terrain-maps.md (albedo.png).
// Tracking copy: the node snippet in the .hip is canonical.
//
// Input `photo`: the RGB photo over the site, in linear light (as the File COP loads the PNG): divide there,
// then back to display values (sRGB) for the export. Input `height`: the site's heights before the stamps (the
// photo saw the ground, not the objects), square, -1..1 in image space over `size` world units. The water
// line's offset doesn't change the slopes, and under the water the albedo isn't used.
// `sun_dir` points toward the photo's sun, in world axes, swizzled into image axes like bake_shadow.cl (.zyx).
// Not the web's sun (bake_shadow.cl's sun_dir): that one lights the albedo afterwards, this one is the light
// already in the photo. The 2024 aerial photos: azimuth 16°, elevation 46° (fitted against the DEM), so
// (0.668, 0.719, 0.191).
// albedo = photo × (k + flat) / (k + n·L), flat being n·L on flat ground, so flat ground keeps its brightness;
// the same factor on R, G and B, so the colours stay. k is the photo's sky light against its sun: lower takes
// out more shading and brings up the noise in the shade, so the factor stops at max_gain. Tune k in the web's
// Debug view 4 (the ground's colour, unlit): stop when the ridges no longer read. No cast shadows: under a sun
// 46° up, the photo has few, in the gorges.

#bind layer photo float3
#bind layer height float
#bind layer !&albedo float3
#bind parm sun_dir  float3 val={0.668, 0.719, 0.191}
#bind parm size     float  val=2000
#bind parm k        float  val=0.5
#bind parm max_gain float  val=2

@KERNEL
{
    float3 L = normalize(@sun_dir).zyx;          // toward the photo's sun, in image axes (x: world Z, z: world X)
    float px = 2.0f / @height.xres;              // one height pixel, in image units
    float lo = -1.0f + 0.5f * px, hi = 1.0f - 0.5f * px;
    float2 P = @P;

    // The ground's normal from central differences (one-sided at the edges), in the same axes
    float2 xa = (float2)(clamp(P.x - px, lo, hi), P.y), xb = (float2)(clamp(P.x + px, lo, hi), P.y);
    float2 ya = (float2)(P.x, clamp(P.y - px, lo, hi)), yb = (float2)(P.x, clamp(P.y + px, lo, hi));
    float dx = (@height.imageSample(xb) - @height.imageSample(xa)) / ((xb.x - xa.x) * 0.5f * @size);
    float dy = (@height.imageSample(yb) - @height.imageSample(ya)) / ((yb.y - ya.y) * 0.5f * @size);
    float3 n = normalize((float3)(-dx, 1.0f, -dy));

    float s = fmax(dot(n, L), 0.0f);
    float flat = fmax(L.y, 0.0f);
    float gain = fmin((@k + flat) / fmax(@k + s, 1e-3f), @max_gain);
    @albedo.set(@photo.imageSample(P) * gain);
}
