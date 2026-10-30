// The ground, shared by every program that needs it (terrain, dust, legend shadows): the heightmap
// (doc/formats/heightmap.md) blended over a band along its edges into the far map around it, if there is one
// (the same format, low resolution, over a large area), itself blended into an endless noise field beyond;
// so the terrain has no border. Never below the sea: `height()` is the surface, flat at uSeaLevel over the
// water (0 by contract, the exports' altitude 0; unset means 0), while `terrainHeight()` keeps the seabed
// (the water's depth). Include with `#include /terrain;`, after `#include /noise;`.
//
// Two ways to read the heights. `height()` lets the GPU filter the texture: one read, but hardware bilinear
// filtering isn't exact (its weights are fixed point, 8 bits of sub-texel precision; some GPUs also blend
// half floats at half precision), so a steep slope seen at a grazing angle comes out stepped, whatever the
// file's precision (iq's "hardware interpolation" article). `heightExact()` (and `terrainHeight()`,
// `terrainNormal()`) filter it here, in fp32, from the four texels around the point: exact, four reads. The
// march steps with the first and switches to the second near the ground; programs that don't set
// uExactHeights (dust, shadow ceiling) read the cheap way everywhere.
//
// MIRROR OF web/src/lib/terrain/farfield.ts + ground.ts: the CPU (camera, picking) must agree with this.
// Change both together.

uniform highp sampler2D uHeightmap; // RG16F, normalized 0..1 as r + g / 2048 (heightfield.ts), no mipmaps
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

// A height texel's normalized value: the main half float plus the remainder (heightfield.ts)
float heightTexel(vec2 v) {
	return v.x + v.y / 2048.0;
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

// The heightmap's normalized value at uv: exact (bilinear in fp32 from four texels) or the GPU's filtering.
// textureLod / texelFetch: called inside loops, where implicit derivatives aren't defined
float mapValue(vec2 uv, bool exact) {
	if (!exact) return heightTexel(textureLod(uHeightmap, uv, 0.0).rg);
	ivec2 lo, hi;
	vec2 f;
	texelCell(uv, vec2(textureSize(uHeightmap, 0)), lo, hi, f);
	float a = heightTexel(texelFetch(uHeightmap, lo, 0).rg);
	float b = heightTexel(texelFetch(uHeightmap, ivec2(hi.x, lo.y), 0).rg);
	float c = heightTexel(texelFetch(uHeightmap, ivec2(lo.x, hi.y), 0).rg);
	float d = heightTexel(texelFetch(uHeightmap, hi, 0).rg);
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// The same for the far map
float farMapValue(vec2 uv, bool exact) {
	if (!exact) return heightTexel(textureLod(uFarMap, uv, 0.0).rg);
	ivec2 lo, hi;
	vec2 f;
	texelCell(uv, vec2(textureSize(uFarMap, 0)), lo, hi, f);
	float a = heightTexel(texelFetch(uFarMap, lo, 0).rg);
	float b = heightTexel(texelFetch(uFarMap, ivec2(hi.x, lo.y), 0).rg);
	float c = heightTexel(texelFetch(uFarMap, ivec2(lo.x, hi.y), 0).rg);
	float d = heightTexel(texelFetch(uFarMap, hi, 0).rg);
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float mapHeight(vec2 xz, bool exact) {
	return mix(uBoundsMin.y, uBoundsMax.y, mapValue(terrainUv(xz), exact));
}

float farHeight(vec2 xz) {
	return uFarField.x + uFarField.y * (farFbm(xz / uFarField.z) * 2.0 - 1.0);
}

float farMapHeight(vec2 xz, bool exact) {
	vec2 uv = (xz - uFarBounds.xy) / (uFarBounds.zw - uFarBounds.xy);
	return mix(uFarRange.x, uFarRange.y, farMapValue(uv, exact));
}

// Around the heightmap: the far map where there is one, fading into the noise at its edges
float surroundings(vec2 xz, bool exact) {
	if (uFarRange.z > 0.0) {
		vec2 d = min(xz - uFarBounds.xy, uFarBounds.zw - xz);
		float m = smoothstep(0.0, uFarRange.z, min(d.x, d.y));
		if (m >= 1.0) return farMapHeight(xz, exact);
		if (m > 0.0) return mix(farHeight(xz), farMapHeight(xz, exact), m);
	}
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

// Surface normal from central differences, one heightmap texel apart (up over the sea), from exact heights.
vec3 terrainNormal(vec2 xz) {
	vec2 e = (uBoundsMax.xz - uBoundsMin.xz) / vec2(textureSize(uHeightmap, 0));
	float dx = heightExact(xz + vec2(e.x, 0.0)) - heightExact(xz - vec2(e.x, 0.0));
	float dz = heightExact(xz + vec2(0.0, e.y)) - heightExact(xz - vec2(0.0, e.y));
	return normalize(vec3(-dx / (2.0 * e.x), 1.0, -dz / (2.0 * e.y)));
}
