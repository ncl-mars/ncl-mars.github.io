#version 300 es
precision highp float;
precision highp int;

// The light shafts, blurred once the view has settled (Terrain.ts): the march's per-pixel shafts value (the
// cache's alpha) is grain, its few samples offset per pixel by blue noise. One direction per pass (along x,
// then along y), a Gaussian over uRadius texels; each tap weighted by how close its distance from the camera is
// to this pixel's, so a ridge's shafts don't spread onto the ground in front of it, and the sky takes no part.

uniform sampler2D uInput;       // pass 1: the cache (shafts in alpha); pass 2: pass 1's result (in red)
uniform float uFromAlpha;       // 1: read the alpha (pass 1), 0: the red (pass 2)
uniform highp sampler2D uDepth; // the cache's depth (highp: samplers default to lowp, which would ruin it)
uniform ivec2 uDirection;       // (1, 0) or (0, 1)
uniform int uRadius;            // texels on each side, at most 16
uniform vec2 uNearFar;          // the camera's, as the cache was marched (it hasn't moved since)

out vec4 outColor;

// A tap counts fully within 5 % of this pixel's distance, not at all past 10 %
const float TOLERANCE = 0.05;

// Distance along the view axis at texel p, from the depth buffer's value; −1 for the sky
float distanceAt(ivec2 p) {
	float d = texelFetch(uDepth, p, 0).r;
	if (d >= 1.0) return -1.0;
	float z = d * 2.0 - 1.0;
	return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x));
}

float shaftsAt(ivec2 p) {
	vec4 v = texelFetch(uInput, p, 0);
	return mix(v.r, v.a, uFromAlpha);
}

void main() {
	ivec2 p = ivec2(gl_FragCoord.xy);
	ivec2 last = textureSize(uDepth, 0) - 1;
	float own = shaftsAt(p);
	float centre = distanceAt(p);
	if (centre < 0.0 || uRadius < 1) {
		outColor = vec4(own);
		return;
	}
	float spread = 2.0 * pow(float(uRadius) * 0.5, 2.0); // 2σ², σ half the radius
	float sum = own;
	float total = 1.0;
	for (int i = -16; i <= 16; i++) {
		if (i == 0 || abs(i) > uRadius) continue;
		ivec2 q = clamp(p + uDirection * i, ivec2(0), last);
		float d = distanceAt(q);
		if (d < 0.0) continue;
		float w = exp(-float(i * i) / spread) * (1.0 - smoothstep(TOLERANCE, 2.0 * TOLERANCE, abs(d - centre) / centre));
		sum += shaftsAt(q) * w;
		total += w;
	}
	outColor = vec4(sum / total);
}
