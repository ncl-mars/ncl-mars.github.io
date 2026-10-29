// The atmosphere, shared by every pass drawn in the scene (the terrain composite now; cords, particles,
// splats later), so everything sits in the same fog. Include with `#include /fog;`, after /noise and /wind.
//
// Three layers:
// - distance fog, fully opaque at uFogEnd, so the endless ground dissolves;
// - height mist, dense low down and thinning with height (closed-form along the ray), so it pools in
//   valleys and pits;
// - mist banks: wind-scrolled noise modulating the mist, so it drifts.
// The fog colour brightens toward the sun.
// Light shafts: the terrain passes how much of the air on the way the sun reaches (`lit`, mist and haze,
// from the ground's shadow volumes: drawables/terrain/shafts.glsl). Air in shadow loses the sun's glow and
// darkens; lit air glows toward the sun. Other passes call atmosphere() without it: all lit.
// The CPU mirrors the distance fog and the mist (not the banks) in terrain/atmosphere.ts, to fade the labels.
// The shafts only change the colour, not how much fog there is, so the mirror ignores them.
// Needs the 3D noise texture bound as uNoise (gl/noise.ts, renderer.resource('noise:3d', …)).

uniform vec3 uFogColor;   // fog and horizon (also the page background)
uniform vec3 uSkyColor;   // sky overhead
uniform float uFogDensity;
uniform float uFogEnd;
uniform vec3 uSunDir;     // toward the sun (the bake's)
uniform vec3 uSunColor;
uniform vec2 uSunGlow;    // x: strength, y: tightness (power)
uniform vec4 uMist;       // x: density at the base, y: base height (world), z: falloff height, w: bank strength
uniform float uBankScale; // size of the mist banks, world units
uniform highp sampler3D uNoise; // gl/noise.ts: 4 tileable gradient noises, sample with p / 8
uniform vec3 uShafts;     // light shafts: x darkening of air in shadow, y glow of lit air toward the sun, z its tightness

// How much the air glows toward the sun: the fog's own glow, plus the light shafts' wider one. The sky
// glows the same, so the far fog meets it without a seam.
float sunGlow(vec3 rd) {
	float facing = max(dot(rd, uSunDir), 0.0);
	return uSunGlow.x * pow(facing, uSunGlow.y) + uShafts.y * pow(facing, max(uShafts.z, 1.0));
}

vec3 fogColorToward(vec3 rd) {
	return uFogColor + uSunColor * sunGlow(rd);
}

vec3 skyColor(vec3 rd) {
	return mix(fogColorToward(rd), uSkyColor, smoothstep(0.0, 0.45, rd.y));
}

// Two layers drifting at different speeds, so the banks change shape as they move. ~[0, 1]
// From the noise texture (two channels of a 2D slice): runs for every pixel and every dust speck, every
// frame, so one fetch per layer instead of hashing lattice corners. Level 0: also called from vertex
// shaders and inside branches, and the banks are far larger than a pixel.
float mistBanks(vec2 xz) {
	vec2 scroll = windScroll();
	float a = textureLod(uNoise, vec3((xz - scroll) / uBankScale, 0.25) / 8.0, 0.0).r;
	float b = textureLod(uNoise, vec3((xz - scroll * 1.7) / (uBankScale * 0.45), 0.6) / 8.0, 0.0).g;
	// Gradient noise stays closer to its mean than value noise: stretched to a similar contrast
	return clamp((a * 0.65 + b * 0.35 - 0.5) * 1.8 + 0.5, 0.0, 1.0);
}

// Optical depth of the height mist from ro along rd over t: ∫ density · exp(−(y − base) / falloff) ds,
// in closed form. Written as a difference of exponentials of relative heights, so it can't overflow.
float mistDepth(vec3 ro, vec3 rd, float t) {
	float h0 = clamp((ro.y - uMist.y) / uMist.z, -30.0, 80.0);
	if (abs(rd.y) < 1e-4) return uMist.x * exp(-h0) * t;
	float h1 = clamp((ro.y + rd.y * t - uMist.y) / uMist.z, -30.0, 80.0);
	return uMist.x * uMist.z * (exp(-h0) - exp(-h1)) / rd.y;
}

// Fog `col`, seen from ro along rd at distance t. `lit`: share of the air on the way that the sun reaches.
vec3 atmosphere(vec3 col, vec3 ro, vec3 rd, float t, float lit) {
	// Banks sampled at the end point and halfway: enough for a low, slow layer
	float banks = 0.5 * (mistBanks(ro.xz + rd.xz * t) + mistBanks(ro.xz + rd.xz * t * 0.5));
	float mist = mistDepth(ro, rd, t) * mix(1.0 - uMist.w, 1.0 + uMist.w, banks);
	float distanceFog = max(1.0 - exp(-t * uFogDensity), smoothstep(uFogEnd * 0.55, uFogEnd, t));
	float fog = 1.0 - (1.0 - distanceFog) * exp(-mist);
	// Light shafts: air in the ground's shadow scatters no sunlight. They melt into the fog with distance
	// (where the fog turns opaque), so the far ground meets the sky without a seam.
	lit = mix(lit, 1.0, smoothstep(uFogEnd * 0.55, uFogEnd, t));
	return mix(col, uFogColor * (1.0 - uShafts.x * (1.0 - lit)) + uSunColor * sunGlow(rd) * lit, fog);
}

vec3 atmosphere(vec3 col, vec3 ro, vec3 rd, float t) {
	return atmosphere(col, ro, rd, t, 1.0);
}
