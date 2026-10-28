// The core sample as a solid of rock, in its local space: a square prism (x, z in [-0.5, 0.5], y up) from
// uBottom up to the cut. Needs /noise.
// - The cut (top face) sits at uCut, displaced by low-frequency noise that evolves with depth, plus the
//   micro relief of the image(s) at that depth: their depth maps, blended by uWeights (plain rock between).
// - The walls are roughened by low-frequency 3D noise, continuous around the corners.
// - The colour: two mineral tones in thin dipping strata bands, with grain.

uniform float uCut;               // height of the cut (descends as you dig)
uniform float uBottom;            // bottom of the core
uniform vec3 uTopNoise;           // x: amplitude, y: frequency (per core width), z: evolution with depth
uniform vec2 uSideNoise;          // x: amplitude, y: frequency
uniform highp sampler2D uReliefA; // depth maps of the two images nearest the cut (doc/formats/relief.md)
uniform highp sampler2D uReliefB;
uniform vec4 uRectA;              // each image inside the top square (uv): xy = min corner, zw = size
uniform vec4 uRectB;
uniform vec2 uWeights;            // presence of each image at this depth (0 = plain rock)
uniform float uMicro;             // micro relief height
uniform float uSpacing;           // strata thickness between images
uniform vec2 uDip;                // slope of the colour bands
uniform vec3 uMineral;
uniform vec3 uMineral2;
uniform float uStrata;            // contrast between the two tones

// An image's relief at a top-face uv, inside its rectangle, fading out through an irregular edge
float imprint(highp sampler2D relief, vec4 rect, vec2 uv) {
	vec2 imageUv = (uv - rect.xy) / rect.zw;
	vec2 edge = min(imageUv, 1.0 - imageUv) * rect.zw;
	float rough = (valueNoise(uv * 23.0) - 0.5) * 0.04;
	float mask = smoothstep(0.0, 0.04, min(edge.x, edge.y) + rough);
	return textureLod(relief, clamp(imageUv, 0.0, 1.0), 0.0).r * mask;
}

float coreTop(vec2 xz) {
	float lf = (valueNoise3(vec3(xz * uTopNoise.y, uCut * uTopNoise.z)) - 0.5) * 2.0 * uTopNoise.x;
	vec2 uv = xz + 0.5;
	float micro = 0.0;
	if (uWeights.x > 0.0) micro += uWeights.x * imprint(uReliefA, uRectA, uv);
	if (uWeights.y > 0.0) micro += uWeights.y * imprint(uReliefB, uRectB, uv);
	return uCut + lf + micro * uMicro;
}

float sideRough(vec3 p) {
	float n = valueNoise3(p * uSideNoise.y) * 0.65 + valueNoise3(p * uSideNoise.y * 2.3 + 7.1) * 0.35;
	return (n - 0.5) * 2.0 * uSideNoise.x;
}

// Signed distance, negative inside the rock. Approximate (conservative outside the edges); the march
// takes partial steps because the displaced top isn't an exact distance.
float sdCore(vec3 p) {
	float side = max(abs(p.x), abs(p.z)) - 0.5 - sideRough(p);
	float top = p.y - coreTop(p.xz);
	float bottom = uBottom - p.y;
	return max(side, max(top, bottom));
}

vec3 rockColour(vec3 p) {
	float wobble = (valueNoise3(p * 4.0) - 0.5) * 0.6;
	float band = floor((p.y + dot(uDip, p.xz)) / (uSpacing * 0.5) + wobble);
	float tone = latticeHash3(ivec3(int(band), 7, 13)) * uStrata;
	float grain = valueNoise3(p * 40.0) * 0.6 + valueNoise3(p * 11.0) * 0.4;
	return mix(uMineral, uMineral2, tone) * (0.82 + 0.36 * grain);
}
