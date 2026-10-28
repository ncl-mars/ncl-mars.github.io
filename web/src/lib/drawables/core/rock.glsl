// The core sample as a solid of rock, in its local space: a square prism (x, z in [-0.5, 0.5], y up) from
// uBottom up to the cut. Noise comes from textures (gl/noise.ts): smooth tileable gradient noise in 3D
// and a hash texture, so there are no blocky value-noise cells and fbm costs a few fetches.
// - The cut (top face) sits at uCut, undulating with the rock's own low-frequency noise (sampled in rock
//   space, so its shape changes exactly as fast as the material goes by).
// - Images are buried in the rock at their depth and revealed by the cut: as it comes down, the highest
//   parts of the relief emerge first, then the whole image; below it, the relief is sanded flat.
// - Walls: low-frequency roughness. Colour: fine strata bands with fbm-warped boundaries, one tone per
//   band from the hash texture, thin lines between bands, smooth grain.

uniform highp sampler3D uNoise3D; // 4 independent tileable gradient noises (RGBA), 8 cells per tile
uniform highp sampler2D uHash;    // 256² white noise (NEAREST)
uniform float uCut;               // height of the cut (descends as you dig)
uniform float uBottom;            // bottom of the core
uniform vec2 uTopNoise;           // cut undulation: x amplitude, y frequency (cells per core width)
uniform vec2 uSideNoise;          // wall roughness: x amplitude, y frequency
uniform highp sampler2D uReliefA; // depth maps of the two images nearest the cut (doc/formats/relief.md)
uniform highp sampler2D uReliefB;
uniform vec4 uRectA;              // each image inside the top square (uv): xy = min corner, zw = size
uniform vec4 uRectB;
uniform vec2 uDepths;             // depth (local y) of image A and B
uniform vec2 uActive;             // 1 when image A / B is bound
uniform float uMicro;             // micro relief height
uniform float uEmerge;            // range above an image's depth over which its relief emerges
uniform float uSand;              // range below it over which the relief is sanded flat
uniform float uBand;              // thickness of a colour band
uniform float uWarp;              // waviness of the band boundaries
uniform vec2 uDip;                // slope of the bands
uniform vec3 uMineral;
uniform vec3 uMineral2;
uniform float uStrata;            // contrast between band tones
uniform float uGrain;             // grain strength
uniform float uNoiseScale;        // noise cells per core width for the colour

// Four independent smooth noises at p (in noise cells), mean ≈ 0.5. textureLod: also called in loops.
vec4 noise4(vec3 p) {
	return textureLod(uNoise3D, p * 0.125, 0.0);
}

vec4 fbm4(vec3 p) {
	vec4 sum = vec4(0.0);
	float amp = 0.5;
	for (int i = 0; i < 4; i++) {
		sum += noise4(p) * amp;
		p = p * 2.03 + 1.7;
		amp *= 0.5;
	}
	return sum / 0.9375;
}

// An image's relief at a top-face uv, inside its rectangle, fading out through an irregular edge
float imprint(highp sampler2D relief, vec4 rect, vec2 uv) {
	vec2 imageUv = (uv - rect.xy) / rect.zw;
	vec2 edge = min(imageUv, 1.0 - imageUv) * rect.zw;
	float rough = (noise4(vec3(uv * 9.0, 3.7)).r - 0.5) * 0.05;
	float mask = smoothstep(0.0, 0.04, min(edge.x, edge.y) + rough);
	return textureLod(relief, clamp(imageUv, 0.0, 1.0), 0.0).r * mask;
}

// How exposed a point of an image (relief value r) is when the cut is at c
float exposure(float r, float depth, float c) {
	float emerged = clamp((depth + uEmerge * r - c) / (uEmerge * 0.2 + 1e-4), 0.0, 1.0);
	float sanded = smoothstep(0.0, uSand, depth - c);
	return emerged * (1.0 - sanded);
}

float coreTop(vec2 xz) {
	float c = uCut;
	float undulation = (noise4(vec3(xz.x, c, xz.y) * uTopNoise.y + 5.3).a - 0.5) * 2.0 * uTopNoise.x;
	vec2 uv = xz + 0.5;
	float relief = 0.0;
	if (uActive.x > 0.5) {
		float r = imprint(uReliefA, uRectA, uv);
		relief += r * exposure(r, uDepths.x, c);
	}
	if (uActive.y > 0.5) {
		float r = imprint(uReliefB, uRectB, uv);
		relief += r * exposure(r, uDepths.y, c);
	}
	return c + undulation + relief * uMicro;
}

float sideRough(vec3 p) {
	return (fbm4(p * uSideNoise.y).r - 0.5) * 2.0 * uSideNoise.x;
}

// Signed distance, negative inside the rock. Approximate (conservative outside the edges); the march
// takes partial steps because the displaced top isn't an exact distance. The noisy terms are only
// evaluated where they can matter.
float sdCore(vec3 p) {
	float edge = max(abs(p.x), abs(p.z));
	float side = edge - 0.5 - (edge > 0.4 ? sideRough(p) : 0.0);
	float top = p.y > uCut - uTopNoise.x - 0.05 ? p.y - coreTop(p.xz) : p.y - (uCut - uTopNoise.x);
	float bottom = uBottom - p.y;
	return max(side, max(top, bottom));
}

vec3 rockColour(vec3 p) {
	vec3 q = p * uNoiseScale;
	vec4 large = fbm4(q * 0.5);
	float layer = (p.y + dot(uDip, p.xz)) / uBand + (large.g - 0.5) * 2.0 * uWarp;
	float id = floor(layer);
	vec4 h = texelFetch(uHash, ivec2(int(mod(id, 256.0)), 17), 0); // per-band random values
	float f = fract(layer);
	float line = smoothstep(0.0, 0.06, f) * (1.0 - smoothstep(0.94, 1.0, f)); // thin darker band edges
	vec3 base = mix(uMineral, uMineral2, h.r * uStrata);
	base *= 0.93 + 0.14 * (large.b - 0.5) * 2.0; // broad tonal drift
	vec4 fine = noise4(q * 7.0);
	base *= 1.0 + uGrain * ((fine.r - 0.5) * 0.5 + (noise4(q * 23.0).g - 0.5) * 0.25);
	return base * mix(0.88, 1.0, line);
}
