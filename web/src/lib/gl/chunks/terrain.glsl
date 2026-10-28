// The ground, shared by every program that needs it (terrain now; cords, particles later): the heightmap
// (doc/formats/heightmap.md) blended into an endless far field over a band along its edges, so the
// terrain has no border. Include with `#include /terrain;`
//
// MIRROR OF web/src/lib/terrain/farfield.ts + ground.ts: the CPU (camera, picking) must agree with this.
// Change both together.

uniform sampler2D uHeightmap; // R16F, normalized 0..1, no mipmaps
uniform vec3 uBoundsMin;      // heightmap world box: x/z are the outer edges of the samples, y the height range
uniform vec3 uBoundsMax;
uniform vec4 uFarField;       // x: base height, y: amplitude (±), z: feature size, w: blend band (world units)

vec2 terrainUv(vec2 xz) {
	return (xz - uBoundsMin.xz) / (uBoundsMax.xz - uBoundsMin.xz);
}

// Integer hash of a lattice point → [0, 1), 24-bit precision (exact in float, like the TS version)
float latticeHash(ivec2 c) {
	uint h = (uint(c.x) * 0x8da6b343u) ^ (uint(c.y) * 0xd8163841u);
	h = (h ^ (h >> 16u)) * 0x7feb352du;
	h = (h ^ (h >> 15u)) * 0x846ca68bu;
	h ^= h >> 16u;
	return float(h >> 8u) * (1.0 / 16777216.0);
}

// Value noise in [0, 1], quintic interpolation
float valueNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = p - i;
	vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
	ivec2 c = ivec2(i);
	float a = latticeHash(c);
	float b = latticeHash(c + ivec2(1, 0));
	float d = latticeHash(c + ivec2(0, 1));
	float e = latticeHash(c + ivec2(1, 1));
	return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}

// Four octaves, normalised to [0, 1]
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

// textureLod: called inside loops, where implicit derivatives aren't defined
float mapHeight(vec2 xz) {
	return mix(uBoundsMin.y, uBoundsMax.y, textureLod(uHeightmap, terrainUv(xz), 0.0).r);
}

float farHeight(vec2 xz) {
	return uFarField.x + uFarField.y * (farFbm(xz / uFarField.z) * 2.0 - 1.0);
}

// Original ground height (no pits): stakes and cords stand on this.
float terrainHeight(vec2 xz) {
	float mask = coreMask(xz);
	if (mask >= 1.0) return mapHeight(xz);
	float outer = farHeight(xz);
	return mask <= 0.0 ? outer : mix(outer, mapHeight(xz), mask);
}

// Final ground height: terrain minus the pits, plus the hover slab (M2d/M3). The raymarch uses this.
float height(vec2 xz) {
	return terrainHeight(xz);
}

// Ground normal from central differences, one heightmap texel apart.
vec3 terrainNormal(vec2 xz) {
	vec2 e = (uBoundsMax.xz - uBoundsMin.xz) / vec2(textureSize(uHeightmap, 0));
	float dx = height(xz + vec2(e.x, 0.0)) - height(xz - vec2(e.x, 0.0));
	float dz = height(xz + vec2(0.0, e.y)) - height(xz - vec2(0.0, e.y));
	return normalize(vec3(-dx / (2.0 * e.x), 1.0, -dz / (2.0 * e.y)));
}
