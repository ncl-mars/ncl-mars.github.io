// Copernicus OpenCL COP: cuts the terrain's site or far map out of a DEM layer: a square `size` metres wide,
// centred `center` metres from the DEM field's centre (x east, y north), resampled to this node's output
// resolution. Heights stay in metres.
// Tracking copy: the node snippet in the .hip is canonical.
//
// Input `src`: a square cut of the field from tools/dem.mjs, north up (image +y), -1..1 in image space over
// `src_size` metres, centred `src_center` metres from the field's centre. field-8m.tif (the whole field at
// 8 m): 45576, (0, 0). area-8km-1m.tif (1 m around the field's centre): 8000, (0, 0).
// The site needs the 1 m heights, the far map does with the 8 m ones. Reference `center` from one node to
// the other, so both cuts share it. An output pixel wider than a source pixel averages n x n samples over
// its area (the far map: 2 x 2); otherwise it's one bilinear sample (the site).

#bind layer src float
#bind layer !&dst float
#bind parm center     float2 val={0, 0}
#bind parm size       float  val=2000
#bind parm src_center float2 val={0, 0}
#bind parm src_size   float  val=8000

@KERNEL
{
    float pixel = @size / @xres;                                    // an output pixel, metres
    int n = max(1, (int)ceil(pixel / (@src_size / @src.xres)));     // samples per side
    float2 here = @center - @src_center + @P * (0.5f * @size);      // metres from the source's centre
    float sum = 0.0f;
    for (int j = 0; j < n; j++) {
        for (int i = 0; i < n; i++) {
            float2 sub = (((float2)((float)i, (float)j) + 0.5f) / (float)n - 0.5f) * pixel;
            sum += @src.imageSample((here + sub) / (0.5f * @src_size));
        }
    }
    @dst.set(sum / (float)(n * n));
}
