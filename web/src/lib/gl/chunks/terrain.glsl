// Terrain heightfield, shared by every program that needs the ground (terrain now; cords, particles later).
// Layout and encoding: doc/formats/heightmap.md. Include with `#include /terrain;`

uniform sampler2D uHeightmap; // R16F, normalized 0..1, no mipmaps
uniform vec3 uBoundsMin;      // world box: x/z are the outer edges of the samples, y the height range
uniform vec3 uBoundsMax;

vec2 terrainUv(vec2 xz) {
	return (xz - uBoundsMin.xz) / (uBoundsMax.xz - uBoundsMin.xz);
}

// Original ground height (no pits): stakes and cords stand on this.
// textureLod: called inside loops, where implicit derivatives aren't defined.
float terrainHeight(vec2 xz) {
	return mix(uBoundsMin.y, uBoundsMax.y, textureLod(uHeightmap, terrainUv(xz), 0.0).r);
}

// Final ground height: terrain minus the pits, plus the hover slab (M2d/M3). The raymarch uses this.
float height(vec2 xz) {
	return terrainHeight(xz);
}

// Ground normal from central differences, one texel apart.
vec3 terrainNormal(vec2 xz) {
	vec2 e = (uBoundsMax.xz - uBoundsMin.xz) / vec2(textureSize(uHeightmap, 0));
	float dx = height(xz + vec2(e.x, 0.0)) - height(xz - vec2(e.x, 0.0));
	float dz = height(xz + vec2(0.0, e.y)) - height(xz - vec2(0.0, e.y));
	return normalize(vec3(-dx / (2.0 * e.x), 1.0, -dz / (2.0 * e.y)));
}
