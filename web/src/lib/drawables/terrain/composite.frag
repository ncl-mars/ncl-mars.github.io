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

#include /common;
#include /noise;
#include /wind;
#include /fog;

uniform sampler2D uColor;
uniform highp sampler2D uDepth; // highp: samplers default to lowp, which would ruin the depth
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform float uFade;            // 0 → 1 once the terrain is loaded
uniform float uShaftView;       // 1: the light shafts' lit share in grey instead of the scene (dev)
uniform float uSeaLevel;
uniform vec4 uWaves;            // x: size (world units), y: speed, z: strength (slope), w: distance they fade over
uniform vec3 uSea;              // x: reflection, y: glint, z: glint tightness
uniform float uPixel;           // a pixel's angle (radians), to filter the waves with distance
uniform sampler2D uShadow;      // the shadow ceiling (shadow.frag), R8 over the slab
uniform vec4 uShadowBox;        // xy: its min corner (world xz), zw: 1 / size
uniform vec2 uSlab;

in vec2 vUv;
out vec4 outColor;

// Mirror of shafts.glsl's sunVisibility: 1 where the sun reaches p
float sunVisibility(vec3 p) {
	vec2 uv = (p.xz - uShadowBox.xy) * uShadowBox.zw;
	if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1.0;
	float ceiling = mix(uSlab.x, uSlab.y, textureLod(uShadow, uv, 0.0).r);
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
		vec3 ground = cached.rgb;
		if (abs(p.y - uSeaLevel) < 0.02 + t * 2e-4 && uSea.x + uSea.y > 0.0) ground = sea(ground, p, rd, t);
		col = atmosphere(ground, uCamPos, rd, t, cached.a);
	} else {
		col = skyColor(rd);
	}
	if (uShaftView > 0.5) col = vec3(texture(uColor, vUv).a);

	gl_FragDepth = depth;
	outColor = vec4(col * uFade, uFade); // premultiplied: fades in over the page background
}
