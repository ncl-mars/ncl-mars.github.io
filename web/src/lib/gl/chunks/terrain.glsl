// The ground, shared by every program that needs it (terrain, dust, legend shadows): the heightmap
// (doc/formats/heightmap.md) blended over a band along its edges into the far map around it, if there is one
// (the same format, low resolution, over a large area), itself blended into an endless noise field beyond;
// so the terrain has no border. Never below the sea: `height()` is the surface, flat at uSeaLevel over the
// water (0 by contract, the exports' altitude 0; unset means 0), while `terrainHeight()` keeps the seabed
// (the water's depth). Include with `#include /terrain;`, after `#include /noise;`.
//
// MIRROR OF web/src/lib/terrain/farfield.ts + ground.ts: the CPU (camera, picking) must agree with this.
// Change both together.

uniform sampler2D uHeightmap; // RG16F, normalized 0..1 as r + g / 2048 (heightfield.ts), no mipmaps
uniform vec3 uBoundsMin;      // heightmap world box: x/z are the outer edges of the samples, y the height range
uniform vec3 uBoundsMax;
uniform vec4 uFarField;       // x: noise base height, y: amplitude (±), z: feature size, w: heightmap blend band (world units)
uniform sampler2D uFarMap;    // the far map (same format), when uFarRange.z > 0
uniform vec4 uFarBounds;      // its world box: min x, min z, max x, max z
uniform vec3 uFarRange;       // x, y: its height range; z: its blend band into the noise (0: no far map)
uniform float uSeaLevel;      // the sea's altitude (tuning.water.level, read by ground.ts too)

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

// A height texture's normalized value is the main half float plus the remainder (heightfield.ts), so a
// 16-bit export keeps its precision. textureLod: called inside loops, where implicit derivatives aren't defined
float mapHeight(vec2 xz) {
	vec2 v = textureLod(uHeightmap, terrainUv(xz), 0.0).rg;
	return mix(uBoundsMin.y, uBoundsMax.y, v.r + v.g / 2048.0);
}

float farHeight(vec2 xz) {
	return uFarField.x + uFarField.y * (farFbm(xz / uFarField.z) * 2.0 - 1.0);
}

float farMapHeight(vec2 xz) {
	vec2 uv = (xz - uFarBounds.xy) / (uFarBounds.zw - uFarBounds.xy);
	vec2 v = textureLod(uFarMap, uv, 0.0).rg;
	return mix(uFarRange.x, uFarRange.y, v.r + v.g / 2048.0);
}

// Around the heightmap: the far map where there is one, fading into the noise at its edges
float surroundings(vec2 xz) {
	if (uFarRange.z > 0.0) {
		vec2 d = min(xz - uFarBounds.xy, uFarBounds.zw - xz);
		float m = smoothstep(0.0, uFarRange.z, min(d.x, d.y));
		if (m >= 1.0) return farMapHeight(xz);
		if (m > 0.0) return mix(farHeight(xz), farMapHeight(xz), m);
	}
	return farHeight(xz);
}

// The terrain itself, the seabed included (no pits): the water's depth is uSeaLevel minus this.
float terrainHeight(vec2 xz) {
	float mask = coreMask(xz);
	if (mask >= 1.0) return mapHeight(xz);
	float outer = surroundings(xz);
	return mask <= 0.0 ? outer : mix(outer, mapHeight(xz), mask);
}

// The surface: the terrain, or the sea over it (later: minus the pits, plus the hover slab). The raymarch,
// the dust, the shadows stand on this.
float height(vec2 xz) {
	return max(terrainHeight(xz), uSeaLevel);
}

// Surface normal from central differences, one heightmap texel apart (up over the sea).
vec3 terrainNormal(vec2 xz) {
	vec2 e = (uBoundsMax.xz - uBoundsMin.xz) / vec2(textureSize(uHeightmap, 0));
	float dx = height(xz + vec2(e.x, 0.0)) - height(xz - vec2(e.x, 0.0));
	float dz = height(xz + vec2(0.0, e.y)) - height(xz - vec2(0.0, e.y));
	return normalize(vec3(-dx / (2.0 * e.x), 1.0, -dz / (2.0 * e.y)));
}
