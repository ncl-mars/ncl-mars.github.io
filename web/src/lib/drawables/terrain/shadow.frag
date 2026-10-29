#version 300 es
precision highp float;
precision highp int; // the noise hash needs 32-bit integers (fragment ints default to mediump)

// The shadow ceiling, for the light shafts (./shafts): for each ground position, the height under which the
// air is in the ground's shadow (a ridge stands between it and the sun). Only depends on the ground and the
// baked sun, so it is rendered once (again when the far field changes), into an R8 texture over the slab.
// A point is shadowed when, walking toward the sun, the ground rises above the sun ray through it:
// ceiling(xz) = max over d of height(xz + toward · d) − d · rise.

#include /common;
#include /noise;
#include /terrain;

uniform vec4 uShadowBox; // xy: min corner (world xz), zw: 1 / size
uniform vec2 uSlab;      // height range of the whole ground (min, max): the texture's 0..1
uniform vec3 uSunDir;    // toward the sun (the bake's)
uniform vec2 uWalk;      // x: step toward the sun (world units), y: step count (0: no shadows)

in vec2 vUv;
out vec4 outColor;

void main() {
	vec2 xz = uShadowBox.xy + vUv / uShadowBox.zw;
	float run = length(uSunDir.xz);
	vec2 toward = uSunDir.xz / max(run, 1e-6);
	float rise = uSunDir.y / max(run, 1e-6); // height of the sun ray per unit walked toward the sun
	float ceiling = uSlab.x;
	int steps = int(uWalk.y);
	for (int i = 1; i <= 256; i++) {
		if (i > steps) break;
		float d = float(i) * uWalk.x;
		ceiling = max(ceiling, height(xz + toward * d) - d * rise);
	}
	outColor = vec4((ceiling - uSlab.x) / (uSlab.y - uSlab.x), 0.0, 0.0, 1.0);
}
