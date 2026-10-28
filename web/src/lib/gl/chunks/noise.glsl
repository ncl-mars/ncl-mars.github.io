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

// 3D lattice hash → [0, 1) (GPU only: nothing on the CPU needs 3D noise)
float latticeHash3(ivec3 c) {
	uint h = (uint(c.x) * 0x8da6b343u) ^ (uint(c.y) * 0xd8163841u) ^ (uint(c.z) * 0xcb1ab31fu);
	h = (h ^ (h >> 16u)) * 0x7feb352du;
	h = (h ^ (h >> 15u)) * 0x846ca68bu;
	h ^= h >> 16u;
	return float(h >> 8u) * (1.0 / 16777216.0);
}

// 3D value noise in [0, 1], quintic interpolation (continuous across a solid's faces and corners)
float valueNoise3(vec3 p) {
	vec3 i = floor(p);
	vec3 f = p - i;
	vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
	ivec3 c = ivec3(i);
	float x00 = mix(latticeHash3(c), latticeHash3(c + ivec3(1, 0, 0)), u.x);
	float x10 = mix(latticeHash3(c + ivec3(0, 1, 0)), latticeHash3(c + ivec3(1, 1, 0)), u.x);
	float x01 = mix(latticeHash3(c + ivec3(0, 0, 1)), latticeHash3(c + ivec3(1, 0, 1)), u.x);
	float x11 = mix(latticeHash3(c + ivec3(0, 1, 1)), latticeHash3(c + ivec3(1, 1, 1)), u.x);
	return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
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
