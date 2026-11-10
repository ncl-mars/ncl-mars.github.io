#version 300 es
precision highp float;
precision highp int; // the noise hash needs 32-bit integers (fragment ints default to mediump)

// Every frame: the cached ground (colour + depth) under the live atmosphere (fog, height mist, wind-driven
// banks, sun glow). Rebuilds each pixel's world position from the cached depth, and writes that depth back
// so later passes (cords, particles, splats) composite against the ground.
// The sea moves here, not in the cache: where the surface lies on the sea plane (terrain.frag puts water
// exactly on it), waves tilt its normal (two layers of the noise texture, drifting with the wind and slowly
// changing, filtered with distance so they don't sparkle), and it reflects the sky (Fresnel) and the sun's
// glint, cut where the shadow ceiling says the sun doesn't reach.
// All in linear light (the cache decodes to it), then /tonemap's display(): exposure, tone curve, sRGB encode.

#include /common;
#include /noise;
#include /wind;
#include /fog;
#include /tonemap;

uniform sampler2D uColor;       // the cache: linear light, sRGB bytes (decoded when sampled), alpha the light shafts
uniform float uExposure;        // the ground's, against the fog (the cache holds it unexposed: ≤ 1 in 8 bits)
uniform vec4 uVignette;         // x: strength, y: radius, z: softness (1: the screen's corner), w: the view's aspect
uniform highp sampler2D uDepth; // highp: samplers default to lowp, which would ruin the depth
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform float uFade;            // 0 → 1 once the terrain is loaded
uniform float uShaftView;       // dev views: 1 the light shafts' lit share in grey; 2 the march's ground, a line every metre; 3 the ground lit, 4 its colour unlit (shade.glsl), without fog
uniform float uSeaLevel;
uniform vec4 uWaves;            // x: size (world units), y: speed, z: strength (slope), w: distance they fade over
uniform vec3 uSea;              // x: reflection, y: glint, z: glint tightness
uniform float uPixel;           // a pixel's angle (radians), to filter the waves with distance
uniform sampler2D uShadow;      // the shadow ceiling (shadow.frag), r + g / 255 over the slab (RG8)
uniform vec4 uShadowBox;        // xy: its min corner (world xz), zw: 1 / size
uniform vec2 uSlab;

in vec2 vUv;
out vec4 outColor;

// Mirror of shafts.glsl's sunVisibility: 1 where the sun reaches p
float sunVisibility(vec3 p) {
	vec2 uv = (p.xz - uShadowBox.xy) * uShadowBox.zw;
	if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1.0;
	vec2 c = textureLod(uShadow, uv, 0.0).rg;
	float ceiling = mix(uSlab.x, uSlab.y, c.r + c.g / 255.0);
	return smoothstep(ceiling - 1.5, ceiling + 1.5, p.y);
}

// The waves' slope at xz: two layers of the noise texture (mean 0.5), drifting with the wind at different
// speeds and slowly changing (the texture's third axis), mip-filtered by their size on screen
vec2 waveSlope(vec2 xz, float t) {
	vec2 drift = windScroll();
	float size = max(uWaves.x, 0.1);
	float lod = log2(max(1.0, t * uPixel * 8.0 / size)); // 8 texels per noise cell
	vec3 a = vec3((xz - drift * 0.5) / size, uTime * uWaves.y * 0.1);
	vec3 b = vec3((xz - drift * 0.8) / (size * 0.37) + 3.7, uTime * uWaves.y * 0.17);
	vec4 one = textureLod(uNoise, a / 8.0, lod);
	vec4 two = textureLod(uNoise, b / 8.0, lod + 1.43); // log2(1 / 0.37): the smaller layer, as far
	return ((one.rg - 0.5) + (two.ba - 0.5) * 0.6) * 2.0;
}

vec3 sea(vec3 col, vec3 p, vec3 rd, float t) {
	vec2 slope = waveSlope(p.xz, t) * uWaves.z / (1.0 + t / max(uWaves.w, 1.0));
	vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
	vec3 r = reflect(rd, n);
	r.y = abs(r.y); // a wave tilted past the view would reflect the water: the sky instead
	float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
	float glint = pow(max(dot(r, uSunDir), 0.0), uSea.z) * uSea.y * sunVisibility(p + vec3(0.0, 0.5, 0.0));
	return mix(col, skyColor(r), fresnel * uSea.x) + uSunColor * glint;
}

void main() {
	vec2 ndc = vUv * 2.0 - 1.0;
	vec4 farPoint = uInvViewProj * vec4(ndc, 1.0, 1.0);
	vec3 rd = normalize(farPoint.xyz / farPoint.w - uCamPos);

	float depth = texture(uDepth, vUv).r;
	vec3 col;
	if (depth < 1.0) {
		vec4 h = uInvViewProj * vec4(ndc, depth * 2.0 - 1.0, 1.0);
		vec3 p = h.xyz / h.w;
		float t = length(p - uCamPos);
		vec4 cached = texture(uColor, vUv); // alpha: the light shafts (terrain.frag)
		vec3 ground = cached.rgb * uExposure;
		if (uSea.x + uSea.y > 0.0 && rd.y < 0.0 && uCamPos.y > uSeaLevel) {
			// Water? Asked with the cache texel's own ray: the cache can be coarser than the view (the rough march
			// in motion), and its depth with this pixel's ray would land off the plane, in flickering patches
			vec2 cells = vec2(textureSize(uDepth, 0));
			vec2 centre = (floor(vUv * cells) + 0.5) / cells;
			vec4 c = uInvViewProj * vec4(centre * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
			float y = c.y / c.w;
			if (abs(y - uSeaLevel) < 0.02 + t * 2e-4) {
				// Then this pixel's own point on the sea, so the waves stay sharp whatever the cache's resolution
				t = (uSeaLevel - uCamPos.y) / rd.y;
				ground = sea(ground, uCamPos + rd * t, rd, t);
			}
		}
		col = atmosphere(ground, uCamPos, rd, t, cached.a);
	} else {
		col = skyColor(rd);
	}
	col = display(col);
	// Radial vignette, on display values: a circle on screen (the aspect corrected), 1 at the corners
	vec2 q = (vUv - 0.5) * vec2(uVignette.w, 1.0);
	float r = length(q) / length(vec2(uVignette.w, 1.0) * 0.5);
	col *= 1.0 - uVignette.x * smoothstep(uVignette.y, uVignette.y + uVignette.z, r);
	if (uShaftView > 2.5) {
		// The cache as the march drew it (3 the ground lit, 4 its colour unlit): no fog, no exposure or tone
		// curve, only the encode (view 4 shows the albedo as exported)
		col = depth < 1.0 ? linearToSrgb(texture(uColor, vUv).rgb) : vec3(0.6, 0.7, 0.8);
	} else if (uShaftView > 1.5) {
		// The ground as the march found it (rebuilt from the cache's depth, as the passes after it do): a dark
		// line every metre of height, a red one every 10 m in x, a blue one in z. Stairs in that surface show
		// as jagged lines
		vec4 h = uInvViewProj * vec4(ndc, depth * 2.0 - 1.0, 1.0);
		vec3 p = h.xyz / h.w;
		vec3 cell = abs(fract(p * vec3(0.1, 1.0, 0.1) + 0.5) - 0.5) / max(fwidth(p * vec3(0.1, 1.0, 0.1)), vec3(1e-4));
		col = vec3(0.8);
		col = mix(col, vec3(0.1), 1.0 - smoothstep(0.5, 1.5, cell.y));
		col = mix(col, vec3(0.8, 0.2, 0.1), 1.0 - smoothstep(0.5, 1.5, cell.x));
		col = mix(col, vec3(0.1, 0.3, 0.8), 1.0 - smoothstep(0.5, 1.5, cell.z));
		if (depth >= 1.0) col = vec3(0.6, 0.7, 0.8);
	} else if (uShaftView > 0.5) {
		col = vec3(texture(uColor, vUv).a);
	}

	gl_FragDepth = depth;
	outColor = vec4(col * uFade, uFade); // premultiplied: fades in over the page background
}
