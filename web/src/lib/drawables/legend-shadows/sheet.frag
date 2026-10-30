#version 300 es
precision highp float;
precision highp int; // /noise's hash needs 32-bit integers

// Darkens the scene where a view ray crosses a legend segment's shadow (sheet.vert): the sunlight the air
// in it would have scattered toward the eye is missing. The sun is a disc, so the shadow of a thin line
// blurs with distance: sharp and dark behind the line, wider and fainter further on (the same shadow,
// spread). Along the ray's exact stretch in the box, four jittered samples weigh that shadow by the air's
// density (mist, haze), what reaches the eye and whether the sun reaches it at all (the terrain's shadow
// ceiling). Thin seen face-on, a sheet mostly shows when looked along: a streak, strongest toward the sun.
// The light taken away is the sun's share of the haze, colour by colour, so shadowed air turns cooler, as
// in the terrain's god rays.
// Where the ray meets the ground inside the box, the ground is in the line's shadow too: a line on it,
// blurring the same way, fading with the fog like the ground, nothing where a ridge already shades it;
// neutral there, like the baked shadows.

#include /common;
#include /noise;
#include /wind;
#include /fog;

uniform highp sampler2D uDepth; // the terrain cache's depth: the ray stops at the ground
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec4 uViewport;         // the view's rectangle in device px (x, y, width, height)
uniform sampler2D uShadow;      // the terrain's shadow ceiling (drawables/terrain/shadow.frag), r + g / 255 over the slab (RG8)
uniform vec4 uShadowBox;        // xy: its min corner (world xz), zw: 1 / size
uniform vec2 uSlab;
uniform vec4 uSheet;            // x: strength, y: thickness (px), z: longest path counted (world units), w: ground shadow
uniform float uSoftness;        // penumbra: half width added per world unit from the line
uniform float uSeaLevel;
uniform float uPixel;           // a pixel's angle (radians): its footprint, to anti-alias thin shadows
uniform float uFade;            // the terrain's fade in

in vec3 vWorld;
flat in vec3 vOrigin;
flat in mat3 vToBox;
flat in float vVisibility;
flat in float vHalf;
flat in float vWide;
flat in float vReach;

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
	vec2 c = textureLod(uShadow, uv, 0.0).rg;
	float ceiling = mix(uSlab.x, uSlab.y, c.r + c.g / 255.0);
	return smoothstep(ceiling - 1.5, ceiling + 1.5, p.y);
}

// The ground under this pixel, from the terrain cache's depth (dist: its distance). Asked with the cache
// texel's own ray: the cache can be coarser than the view (the rough march in motion), and its depth with
// this pixel's ray would land off the surface, flickering in and out of the shadow. On the sea, this
// pixel's own point on the plane instead, so shadows on the water stay sharp. False over the sky.
bool groundUnder(vec2 uv, vec3 rd, out vec3 g, out float dist) {
	float depth = texture(uDepth, uv).r;
	if (depth >= 1.0) return false;
	vec2 cells = vec2(textureSize(uDepth, 0));
	vec2 centre = (floor(uv * cells) + 0.5) / cells;
	vec4 c = uInvViewProj * vec4(centre * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
	g = c.xyz / c.w;
	dist = length(g - uCamPos);
	if (rd.y < 0.0 && uCamPos.y > uSeaLevel && abs(g.y - uSeaLevel) < 0.02 + dist * 2e-4) {
		dist = (uSeaLevel - uCamPos.y) / rd.y;
		g = uCamPos + rd * dist;
	}
	return true;
}

float airDensity(vec3 p, float banks) {
	return uMist.x * exp(-(p.y - uMist.y) / uMist.z) * banks + uFogDensity;
}

// How much of the sun the line hides at box point b: its shadow (half width vHalf) blurred by the sun's
// disc at b's distance from the line: a trapezoid across, no darker than the line covers of the disc.
// Blurred at least over `pixel` (half a pixel's footprint there), so a shadow thinner than a pixel spreads
// and fades instead of breaking into stairs.
float occlusion(vec3 b, float pixel) {
	float penumbra = max(b.y * vReach * uSoftness, pixel);
	float inner = abs(vHalf - penumbra);
	float outer = max(vHalf + penumbra, inner + 1e-4);
	return min(1.0, vHalf / max(penumbra, 1e-6)) * (1.0 - smoothstep(inner, outer, abs(b.z) * vWide));
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

	// The ray stops at the ground; if that ground is inside the box, it's in the shadow
	vec2 uv = (gl_FragCoord.xy - uViewport.xy) / uViewport.zw;
	vec3 g;
	float tGround;
	float ground = 0.0;
	if (groundUnder(uv, rd, g, tGround)) {
		vec3 bg = vToBox * (g - vOrigin);
		bool inside = all(greaterThanEqual(bg, vec3(0.0, 0.0, -1.0))) && all(lessThanEqual(bg, vec3(1.0)));
		if (inside && uSheet.w > 0.0) {
			float fog = max(1.0 - exp(-tGround * uFogDensity), smoothstep(uFogEnd * 0.55, uFogEnd, tGround));
			float seen = (1.0 - fog) * exp(-mistDepth(uCamPos, rd, tGround));
			// On the ground a pixel's footprint stretches as the view grazes it
			float pixel = tGround * uPixel * 0.5 / max(-rd.y, 0.15);
			ground = uSheet.w * occlusion(bg, pixel) * sunVisibility(g + vec3(0.0, 1.5, 0.0)) * seen;
		}
		t1 = min(t1, tGround);
	}
	float path = min(t1 - t0, uSheet.z);

	// The light the air in the shadow would have scattered toward the eye, sampled along the stretch.
	// Seen face-on, a sheet is too thin to show: skipped (an upper estimate, densest banks)
	vec3 air = vec3(0.0);
	float tm = t0 + path * 0.5;
	float darkest = min(1.0, vHalf / max((o.y + d.y * tm) * vReach * uSoftness, 1e-6));
	if (path > 0.0 && uSheet.x * vVisibility * path * darkest * airDensity(uCamPos + rd * tm, 1.0 + uMist.w) >= 0.004) {
		float banks = mix(1.0 - uMist.w, 1.0 + uMist.w, mistBanks(uCamPos.xz + rd.xz * tm));
		float gap = path / 4.0;
		float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
		float missing = 0.0;
		for (int i = 0; i < 4; i++) {
			float t = t0 + (float(i) + jitter) * gap;
			float shadow = occlusion(o + d * t, t * uPixel * 0.5);
			if (shadow < 0.001) continue;
			vec3 p = uCamPos + rd * t;
			float reach = exp(-uFogDensity * t - mistDepth(uCamPos, rd, t) * banks);
			missing += airDensity(p, banks) * reach * sunVisibility(p) * shadow * gap;
		}
		// The sun's share of the haze, colour by colour (fogColorToward: the fog's colour plus the sun's glow)
		vec3 sunlit = uFogColor * uShafts.x + uSunColor * sunGlow(rd);
		vec3 share = clamp(sunlit / max(fogColorToward(rd), vec3(1e-3)), 0.0, 1.0);
		air = clamp(uSheet.x * (1.0 - exp(-missing)) * share, 0.0, 1.0);
	}
	vec3 shade = (1.0 - (1.0 - air) * (1.0 - ground)) * vVisibility * uFade;
	if (max(shade.r, max(shade.g, shade.b)) < 0.002) discard;
	outColor = vec4(shade, 0.0); // blended as dst × (1 − src), colour by colour
}
