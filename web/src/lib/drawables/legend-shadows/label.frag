#version 300 es
precision highp float;
precision highp int; // /noise's hash needs 32-bit integers

// A label's text, shading the ground and the air (label.vert). In the label's shadow box, a point's x and
// y are where its sun ray crossed the text box: the mask there says if a letter stood in the way.
// - Ground: where the ground seen at this pixel lies inside the box. Fades with the fog like the ground.
// - Air: along the ray's exact stretch inside the box (stopped at the ground), a few jittered samples of
//   the mask, weighted like the line sheets (air density, what reaches the eye, the sun reaching it).
//   Looking toward the sun, a ray stays behind the same letter: letter-shaped shafts. Across the letters,
//   the mask is read blurred to the gap between samples: a soft veil, not noise.
// Both blur with the distance to the text (the penumbra) and add nothing where a ridge already shades the
// air or the ground. In the air, the light taken away is the sun's share of the haze, colour by colour
// (shadowed air turns cooler, as in the terrain's god rays); on the ground it's neutral, like the baked
// shadows. Both faces of the box cover a pixel: only the one where the ray enters shades it.

#include /common;
#include /noise;
#include /wind;
#include /fog;

uniform highp sampler2D uDepth; // the terrain cache's depth
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec4 uViewport;         // the view's rectangle in device px (x, y, width, height)
uniform sampler2D uShadow;      // the terrain's shadow ceiling (drawables/terrain/shadow.frag), R8 over the slab
uniform vec4 uShadowBox;        // xy: its min corner (world xz), zw: 1 / size
uniform vec2 uSlab;
uniform sampler2D uMasks;       // the labels' text masks, one row each (R8, mipmapped)
uniform vec2 uRowScale[32];
uniform vec3 uAtlas;            // x: rows, y: width in texels, z: a row's height in texels
uniform vec4 uText;             // x: ground strength, y: softness (blur per world unit), z: air strength, w: air samples
uniform float uFade;            // the terrain's fade in

in vec3 vWorld;
flat in vec3 vOrigin;
flat in mat3 vToBox;
flat in float vRow;
flat in float vVisibility;
flat in float vReach;
flat in float vTexel;

out vec4 outColor;

// The ray's parameter range inside lo ≤ o + d·t ≤ hi (one axis of the box)
void clip(float o, float d, float lo, float hi, inout float t0, inout float t1) {
	if (abs(d) < 1e-8) {
		if (o < lo || o > hi) t1 = -1.0;
		return;
	}
	float a = (lo - o) / d;
	float b = (hi - o) / d;
	t0 = max(t0, min(a, b));
	t1 = min(t1, max(a, b));
}

// Mirror of drawables/terrain/shafts.glsl's sunVisibility: 1 where the sun reaches p
float sunVisibility(vec3 p) {
	vec2 uv = (p.xz - uShadowBox.xy) * uShadowBox.zw;
	if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1.0;
	float ceiling = mix(uSlab.x, uSlab.y, textureLod(uShadow, uv, 0.0).r);
	return smoothstep(ceiling - 1.5, ceiling + 1.5, p.y);
}

// The mask at box point b, blurred by its distance to the text, and at least to `lod`
float mask(vec3 b, vec2 extent, float row, float lod) {
	vec2 st = vec2(b.x * extent.x, (row + b.y * extent.y) / uAtlas.x);
	float penumbra = log2(max(1.0, b.z * vReach * uText.y / vTexel));
	return textureLod(uMasks, st, min(max(penumbra, lod), 4.0)).r;
}

void main() {
	vec3 rd = normalize(vWorld - uCamPos);
	vec3 o = vToBox * (uCamPos - vOrigin);
	vec3 d = vToBox * rd;
	float t0 = 0.0;
	float t1 = 1e9;
	clip(o.x, d.x, 0.0, 1.0, t0, t1);
	clip(o.y, d.y, 0.0, 1.0, t0, t1);
	clip(o.z, d.z, 0.0, 1.0, t0, t1);
	float here = length(vWorld - uCamPos);
	if (t1 <= t0 || here - t0 > t1 - here) discard;

	int index = int(vRow + 0.5);
	vec2 extent = uRowScale[index];
	float row = float(index);

	// Ground: where the ray stops inside the box
	vec2 uv = (gl_FragCoord.xy - uViewport.xy) / uViewport.zw;
	float depth = texture(uDepth, uv).r;
	float ground = 0.0;
	if (depth < 1.0) {
		vec4 p = uInvViewProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
		float tGround = length(p.xyz / p.w - uCamPos);
		if (tGround < t1 && uText.x > 0.0) {
			vec3 g = uCamPos + rd * tGround;
			float fog = max(1.0 - exp(-tGround * uFogDensity), smoothstep(uFogEnd * 0.55, uFogEnd, tGround));
			float seen = (1.0 - fog) * exp(-mistDepth(uCamPos, rd, tGround));
			ground = uText.x * mask(o + d * tGround, extent, row, 0.0) * sunVisibility(g + vec3(0.0, 1.5, 0.0)) * seen;
		}
		t1 = min(t1, tGround);
	}

	// Air: the light the shadowed air would have scattered toward the eye, sampled along the stretch
	vec3 air = vec3(0.0);
	int samples = int(uText.w);
	if (uText.z > 0.0 && samples > 0 && t1 > t0) {
		float path = t1 - t0;
		float gap = path / float(samples); // not `step`: that would hide the built-in
		// Blur to the gap between samples, in mask texels, so a ray sweeping across the letters averages them
		vec2 texels = vec2(d.x * extent.x * uAtlas.y, d.y * extent.y * uAtlas.z) * gap;
		float lod = log2(max(1.0, length(texels)));
		float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
		float tm = t0 + path * 0.5;
		float banks = mix(1.0 - uMist.w, 1.0 + uMist.w, mistBanks(uCamPos.xz + rd.xz * tm));
		float missing = 0.0;
		for (int i = 0; i < 16; i++) {
			if (i >= samples) break;
			float t = t0 + (float(i) + jitter) * gap;
			vec3 q = uCamPos + rd * t;
			float m = mask(o + d * t, extent, row, lod);
			if (m < 0.01) continue;
			float density = uMist.x * exp(-(q.y - uMist.y) / uMist.z) * banks + uFogDensity;
			float reach = exp(-uFogDensity * t - mistDepth(uCamPos, rd, t) * banks);
			missing += density * reach * sunVisibility(q) * m * gap;
		}
		// The sun's share of the haze, colour by colour (fogColorToward: the fog's colour plus the sun's glow)
		vec3 sunlit = uFogColor * uShafts.x + uSunColor * sunGlow(rd);
		vec3 share = clamp(sunlit / max(fogColorToward(rd), vec3(1e-3)), 0.0, 1.0);
		air = clamp(uText.z * (1.0 - exp(-missing)) * share, 0.0, 1.0);
	}

	vec3 shade = (1.0 - (1.0 - air) * (1.0 - ground)) * vVisibility * uFade;
	if (max(shade.r, max(shade.g, shade.b)) < 0.002) discard;
	outColor = vec4(shade, 0.0); // blended as dst × (1 − src), colour by colour
}
