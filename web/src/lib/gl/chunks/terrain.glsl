// The ground, shared by every program that needs it (terrain, dust, legend shadows): the heightmap
// (doc/formats/heightmap.md) blended over a band along its edges into the far map around it, if there is one
// (the same format, low resolution, over a large area), itself blended into an endless noise field beyond;
// so the terrain has no border. Never below the sea: `height()` is the surface, flat at uSeaLevel over the
// water (0 by contract, the exports' altitude 0; unset means 0), while `terrainHeight()` keeps the seabed
// (the water's depth). Include with `#include /terrain;`, after `#include /noise;`.
//
// Two ways to read the heights. `height()` lets the GPU filter the texture: one read, but hardware bilinear
// filtering isn't exact (its weights are fixed point, 8 bits of sub-texel precision; some GPUs also blend
// at half precision), so a steep slope seen at a grazing angle comes out stepped, whatever the
// file's precision (iq's "hardware interpolation" article). `heightExact()` (and `terrainHeight()`,
// `terrainNormal()`) read the heightmap as a cubic B-spline, from four reads the GPU filters (GPU Gems 2, Sigg
// & Hadwiger): smoother heights and slopes than bilinear, so the stamps' one-texel steps no longer each catch
// the sun; the samples slightly softened. Its reads go through the same 8-bit weights: on a new device, check
// the steep walls. The far map's fine reads are bilinear in fp32 from four texels (exact). The march steps
// with the first and switches to the second near the ground; programs that don't set uExactHeights (dust,
// shadow ceiling) read the cheap way everywhere.
//
// MIRROR OF web/src/lib/terrain/farfield.ts + ground.ts (the B-spline: heightfield.ts's bsplineAt): the CPU
// (camera, picking) must agree with this. Change both together.

uniform highp sampler2D uHeightmap; // RG8: the 16-bit samples' bytes, R low, G high (heightfield.ts), no mipmaps
uniform vec3 uBoundsMin;      // heightmap world box: x/z are the outer edges of the samples, y the height range
uniform vec3 uBoundsMax;
uniform vec4 uFarField;       // x: noise base height, y: amplitude (±), z: feature size, w: heightmap blend band (world units)
uniform highp sampler2D uFarMap; // the far map (same format), when uFarRange.z > 0
uniform vec4 uFarBounds;      // its world box: min x, min z, max x, max z
uniform vec3 uFarRange;       // x, y: its height range; z: its blend band into the noise (0: no far map)
uniform float uSeaLevel;      // the sea's altitude (tuning.water.level, read by ground.ts too)
uniform float uExactHeights;  // 1: the exact reads filter here in fp32 (tuning.march.exactHeights); 0 or unset: the GPU's

vec2 terrainUv(vec2 xz) {
	return (xz - uBoundsMin.xz) / (uBoundsMax.xz - uBoundsMin.xz);
}

// Four octaves of value noise (/noise), normalised to [0, 1]
float farFbm(vec2 p) {
	float sum = 0.0;
	float amp = 0.5;
	float norm = 0.0;
	for (int o = 0; o < 4; o++) {
		sum += valueNoise(p) * amp;
		norm += amp;
		p = p * 2.03 + vec2(17.1, -9.7);
		amp *= 0.5;
	}
	return sum / norm;
}

// 1 well inside the heightmap, fading to 0 at its edges over the blend band; 0 outside
float coreMask(vec2 xz) {
	vec2 d = min(xz - uBoundsMin.xz, uBoundsMax.xz - xz);
	return smoothstep(0.0, uFarField.w, min(d.x, d.y));
}

vec2 farUv(vec2 xz) {
	return (xz - uFarBounds.xy) / max(uFarBounds.zw - uFarBounds.xy, vec2(1e-3));
}

// The same for the far map, fading into the noise over its own band; 0 without a far map
float farMask(vec2 xz) {
	if (uFarRange.z <= 0.0) return 0.0;
	vec2 d = min(xz - uFarBounds.xy, uFarBounds.zw - xz);
	return smoothstep(0.0, uFarRange.z, min(d.x, d.y));
}

// A height texel's normalized value from its two bytes read as 0..1 (R low, G high): the 16-bit integer
// / 65535, which is (256 high + low) / 257 (65535 = 255 × 257). Filtering is linear, so filtered bytes give
// the filtered height.
float heightTexel(vec2 v) {
	return (v.y * 256.0 + v.x) / 257.0;
}

// The same for a fetched texel, exact: the bytes rounded back to integers first, so the rounding of their
// conversion to floats can't reach the sum (the high byte weighs 256 times more)
float heightTexelExact(vec2 v) {
	vec2 b = round(v * 255.0);
	return (b.y * 256.0 + b.x) / 65535.0;
}

// The texel cell around uv in a texture of `size` texels: the lower and upper texels (clamped to the edge, as
// CLAMP_TO_EDGE and heightfield.ts) and the blend weights
void texelCell(vec2 uv, vec2 size, out ivec2 lo, out ivec2 hi, out vec2 f) {
	vec2 s = clamp(uv * size - 0.5, vec2(0.0), size - 1.0);
	vec2 b = floor(s);
	f = s - b;
	lo = ivec2(b);
	hi = min(lo + 1, ivec2(size) - 1);
}

// The cubic B-spline's weights for the four samples around a point at f (0..1) between the middle two
vec4 bsplineWeights(float f) {
	float g = 1.0 - f;
	float f2 = f * f;
	float f3 = f2 * f;
	return vec4(g * g * g, 4.0 - 6.0 * f2 + 3.0 * f3, 1.0 + 3.0 * (f + f2 - f3), f3) / 6.0;
}

// The heightmap's normalized value at uv as a cubic B-spline over the 4 × 4 texels around it (smooth slopes
// and curvature across the cells; it doesn't pass through the samples, which come out slightly softened), from
// 4 reads the GPU filters (GPU Gems 2, Sigg & Hadwiger: each pair of weights becomes one bilinear read placed
// between its two texels). Not exact: the GPU's 8-bit weights, half precision on some. Clamped at the edges
// like texelCell(); mirrored by heightfield.ts's bsplineAt.
float bsplineValue(vec2 uv) {
	vec2 size = vec2(textureSize(uHeightmap, 0));
	vec2 s = clamp(uv * size - 0.5, vec2(0.0), size - 1.0);
	vec2 b = floor(s);
	vec2 f = s - b;
	vec4 wx = bsplineWeights(f.x);
	vec4 wy = bsplineWeights(f.y);
	vec2 g0 = vec2(wx.x + wx.y, wy.x + wy.y);
	vec2 g1 = vec2(wx.z + wx.w, wy.z + wy.w);
	vec2 h0 = (b - 0.5 + vec2(wx.y, wy.y) / g0) / size; // between texels b - 1 and b
	vec2 h1 = (b + 1.5 + vec2(wx.w, wy.w) / g1) / size; // between texels b + 1 and b + 2
	float v00 = heightTexel(textureLod(uHeightmap, h0, 0.0).rg);
	float v10 = heightTexel(textureLod(uHeightmap, vec2(h1.x, h0.y), 0.0).rg);
	float v01 = heightTexel(textureLod(uHeightmap, vec2(h0.x, h1.y), 0.0).rg);
	float v11 = heightTexel(textureLod(uHeightmap, h1, 0.0).rg);
	return g0.y * (g0.x * v00 + g1.x * v10) + g1.y * (g0.x * v01 + g1.x * v11);
}

// The heightmap's normalized value at uv: the fine read (the B-spline) or the GPU's bilinear filtering.
// textureLod / texelFetch: called inside loops, where implicit derivatives aren't defined
float mapValue(vec2 uv, bool exact) {
	return exact ? bsplineValue(uv) : heightTexel(textureLod(uHeightmap, uv, 0.0).rg);
}

// The same for the far map
float farMapValue(vec2 uv, bool exact) {
	if (!exact) return heightTexel(textureLod(uFarMap, uv, 0.0).rg);
	ivec2 lo, hi;
	vec2 f;
	texelCell(uv, vec2(textureSize(uFarMap, 0)), lo, hi, f);
	float a = heightTexelExact(texelFetch(uFarMap, lo, 0).rg);
	float b = heightTexelExact(texelFetch(uFarMap, ivec2(hi.x, lo.y), 0).rg);
	float c = heightTexelExact(texelFetch(uFarMap, ivec2(lo.x, hi.y), 0).rg);
	float d = heightTexelExact(texelFetch(uFarMap, hi, 0).rg);
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float mapHeight(vec2 xz, bool exact) {
	return mix(uBoundsMin.y, uBoundsMax.y, mapValue(terrainUv(xz), exact));
}

float farHeight(vec2 xz) {
	return uFarField.x + uFarField.y * (farFbm(xz / uFarField.z) * 2.0 - 1.0);
}

float farMapHeight(vec2 xz, bool exact) {
	return mix(uFarRange.x, uFarRange.y, farMapValue(farUv(xz), exact));
}

// Around the heightmap: the far map where there is one, fading into the noise at its edges
float surroundings(vec2 xz, bool exact) {
	float m = farMask(xz);
	if (m >= 1.0) return farMapHeight(xz, exact);
	if (m > 0.0) return mix(farHeight(xz), farMapHeight(xz, exact), m);
	return farHeight(xz);
}

float terrainHeightAt(vec2 xz, bool exact) {
	float mask = coreMask(xz);
	if (mask >= 1.0) return mapHeight(xz, exact);
	float outer = surroundings(xz, exact);
	return mask <= 0.0 ? outer : mix(outer, mapHeight(xz, exact), mask);
}

// The terrain itself, the seabed included (no pits), read exactly: the water's depth is uSeaLevel minus this.
float terrainHeight(vec2 xz) {
	return terrainHeightAt(xz, uExactHeights > 0.5);
}

// The surface: the terrain, or the sea over it (later: minus the pits, plus the hover slab), as the GPU
// filters it: the march's big steps, the dust, the shadow ceiling stand on this.
float height(vec2 xz) {
	return max(terrainHeightAt(xz, false), uSeaLevel);
}

// The same surface, read exactly: the march near the ground, the normal.
float heightExact(vec2 xz) {
	return max(terrainHeightAt(xz, uExactHeights > 0.5), uSeaLevel);
}

// The normal's stencil, in steps of e: the four neighbours, then the four corners (read only with smoothing)
const vec2 STENCIL[8] = vec2[8](
	vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0),
	vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0)
);

// Surface normal from central differences (up over the sea), from the fine heights (the B-spline): one texel
// apart (the heightmap's, widening to the far map's past it), or `span` apart where that's wider (a pixel's
// footprint far away, so relief finer than a pixel averages out instead of crawling as the camera moves). Over
// the far map, one of its own texels: within a texel its bilinear surface is a single patch whose slope jumps
// at the next, and the light drew its grid.
// `smoothing` (in texels, 0: none) blurs the slope: up to 1, the differences fade into a Sobel stencil (also
// averaged across, 1-2-1, so in both directions); past 1, that stencil widens to `smoothing` texels. One-texel
// steps (a stamp's aliased walls) then no longer each catch or miss the sun. 8 reads instead of 4.
// The reads are a loop with a run-time count, not written out: the compiler keeps one copy of heightExact()
// (the whole ground: heightmap, far map, noise) instead of eight, which kept the shader small enough for phones.
vec3 terrainNormal(vec2 xz, float span, float smoothing) {
	vec2 e = (uBoundsMax.xz - uBoundsMin.xz) / vec2(textureSize(uHeightmap, 0));
	if (uFarRange.z > 0.0) e = mix((uFarBounds.zw - uFarBounds.xy) / vec2(textureSize(uFarMap, 0)), e, coreMask(xz));
	e = max(e * max(1.0, smoothing), vec2(span));
	// Central differences and the Sobel stencil mixed by w: (1 − w/2) on the neighbours, w/4 on the corners
	float w = clamp(smoothing, 0.0, 1.0);
	float side = 1.0 - 0.5 * w;
	float corner = 0.25 * w;
	int count = w > 0.0 ? 8 : 4;
	vec2 d = vec2(0.0); // the height differences along x and z, over 2e
	for (int k = 0; k < count; k++) {
		vec2 o = STENCIL[k];
		d += (k < 4 ? side : corner) * o * heightExact(xz + o * e);
	}
	return normalize(vec3(-d.x / (2.0 * e.x), 1.0, -d.y / (2.0 * e.y)));
}
