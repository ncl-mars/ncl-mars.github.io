// Shared noise. Include with `#include /noise;` (once per shader, before the chunks that need it:
// terrain, fog). The including fragment shader must declare `precision highp int;`: the hash needs
// 32-bit integers and fragment ints default to mediump.
//
// latticeHash and valueNoise are MIRRORED in web/src/lib/terrain/farfield.ts (the CPU must agree with the
// far field). Change both together.

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
