#version 300 es
precision highp float;
precision highp int; // /noise's hash needs 32-bit integers

// Darkens the scene where a view ray crosses a legend segment's shadow (sheet.vert): the sunlight the air
// in it would have scattered toward the eye is missing. The ray's path through the box is exact (the box
// faces only say which pixels to look at); along it, the air's density (mist, haze), what reaches the eye
// and whether the sun reaches it at all (the terrain's shadow ceiling) come at three points. Thin seen
// face-on, a sheet only shows when looked along: a streak, strongest toward the sun.
// Where the ray meets the ground inside the box, the ground is in the line's shadow too: a thin line on
// it, soft across, fading with the fog like the ground, nothing where a ridge already shades it.

#include /common;
#include /noise;
#include /wind;
#include /fog;

uniform highp sampler2D uDepth; // the terrain cache's depth: the ray stops at the ground
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec4 uViewport;         // the view's rectangle in device px (x, y, width, height)
uniform sampler2D uShadow;      // the terrain's shadow ceiling (drawables/terrain/shadow.frag), R8 over the slab
uniform vec4 uShadowBox;        // xy: its min corner (world xz), zw: 1 / size
uniform vec2 uSlab;
uniform vec4 uSheet;            // x: strength, y: thickness (px), z: longest path counted (world units), w: ground shadow
uniform float uFade;            // the terrain's fade in

in vec3 vWorld;
flat in vec3 vOrigin;
flat in mat3 vToBox;
flat in float vVisibility;

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

float airDensity(vec3 p, float banks) {
	return uMist.x * exp(-(p.y - uMist.y) / uMist.z) * banks + uFogDensity;
}

void main() {
	vec3 rd = normalize(vWorld - uCamPos);
	vec3 o = vToBox * (uCamPos - vOrigin);
	vec3 d = vToBox * rd;
	float t0 = 0.0;
	float t1 = 1e9;
	clip(o.x, d.x, 0.0, 1.0, t0, t1);
	clip(o.y, d.y, 0.0, 1.0, t0, t1);
	clip(o.z, d.z, -1.0, 1.0, t0, t1);
	// Both faces of the box cover the pixel: only the one where the ray enters counts
	float here = length(vWorld - uCamPos);
	if (t1 <= t0 || here - t0 > t1 - here) discard;

	// The ray stops at the ground; if it does inside the box, that ground is in the shadow
	vec2 uv = (gl_FragCoord.xy - uViewport.xy) / uViewport.zw;
	float depth = texture(uDepth, uv).r;
	float ground = 0.0;
	if (depth < 1.0) {
		vec4 p = uInvViewProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
		float tGround = length(p.xyz / p.w - uCamPos);
		if (tGround < t1 && uSheet.w > 0.0) {
			vec3 g = uCamPos + rd * tGround;
			float across = abs((vToBox * (g - vOrigin)).z); // 0 in the middle of the line, 1 at its edges
			float fog = max(1.0 - exp(-tGround * uFogDensity), smoothstep(uFogEnd * 0.55, uFogEnd, tGround));
			float seen = (1.0 - fog) * exp(-mistDepth(uCamPos, rd, tGround));
			ground = uSheet.w * smoothstep(1.0, 0.4, across) * sunVisibility(g + vec3(0.0, 1.5, 0.0)) * seen;
		}
		t1 = min(t1, tGround);
	}
	float path = min(t1 - t0, uSheet.z);
	if (path <= 0.0 && ground <= 0.0) discard;

	// The light the air in the shadow would have scattered toward the eye, at three points along the path.
	// Seen face-on, a sheet is too thin to show: skipped (an upper estimate, densest banks)
	float air = 0.0;
	float tm = t0 + path * 0.5;
	if (uSheet.x * vVisibility * path * airDensity(uCamPos + rd * tm, 1.0 + uMist.w) >= 0.004) {
		float banks = mix(1.0 - uMist.w, 1.0 + uMist.w, mistBanks(uCamPos.xz + rd.xz * tm));
		float missing = 0.0;
		for (int i = 0; i < 3; i++) {
			float t = t0 + path * (float(i) + 0.5) / 3.0;
			vec3 p = uCamPos + rd * t;
			float reach = exp(-uFogDensity * t - mistDepth(uCamPos, rd, t) * banks);
			missing += airDensity(p, banks) * reach * sunVisibility(p) * path / 3.0;
		}
		float sunlight = clamp(uShafts.x + sunGlow(rd), 0.0, 1.0);
		air = clamp(uSheet.x * sunlight * (1.0 - exp(-missing)), 0.0, 1.0);
	}
	float shade = (1.0 - (1.0 - air) * (1.0 - ground)) * vVisibility * uFade;
	if (shade < 0.002) discard;
	outColor = vec4(0.0, 0.0, 0.0, shade); // blended as dst × (1 − alpha)
}
