// The atmosphere, shared by every pass drawn in the scene (the terrain composite now; cords, particles,
// splats later), so everything sits in the same fog. Include with `#include /fog;`, after /noise and /wind.
//
// Three layers:
// - distance fog, fully opaque at uFogEnd, so the endless ground dissolves;
// - height mist, dense low down and thinning with height (closed-form along the ray), so it pools in
//   valleys and pits;
// - mist banks: wind-scrolled noise modulating the mist, so it drifts.
// The fog colour brightens toward the sun.

uniform vec3 uFogColor;   // fog and horizon (also the page background)
uniform vec3 uSkyColor;   // sky overhead
uniform float uFogDensity;
uniform float uFogEnd;
uniform vec3 uSunDir;     // toward the sun (the bake's)
uniform vec3 uSunColor;
uniform vec2 uSunGlow;    // x: strength, y: tightness (power)
uniform vec4 uMist;       // x: density at the base, y: base height (world), z: falloff height, w: bank strength
uniform float uBankScale; // size of the mist banks, world units

vec3 fogColorToward(vec3 rd) {
	return uFogColor + uSunColor * (uSunGlow.x * pow(max(dot(rd, uSunDir), 0.0), uSunGlow.y));
}

vec3 skyColor(vec3 rd) {
	return mix(fogColorToward(rd), uSkyColor, smoothstep(0.0, 0.45, rd.y));
}

// Two layers drifting at different speeds, so the banks change shape as they move. ~[0, 1]
float mistBanks(vec2 xz) {
	vec2 scroll = windScroll();
	float a = valueNoise((xz - scroll) / uBankScale);
	float b = valueNoise((xz - scroll * 1.7) / (uBankScale * 0.45) + 13.7);
	return a * 0.65 + b * 0.35;
}

// Optical depth of the height mist from ro along rd over t: ∫ density · exp(−(y − base) / falloff) ds,
// in closed form. Written as a difference of exponentials of relative heights, so it can't overflow.
float mistDepth(vec3 ro, vec3 rd, float t) {
	float h0 = clamp((ro.y - uMist.y) / uMist.z, -30.0, 80.0);
	if (abs(rd.y) < 1e-4) return uMist.x * exp(-h0) * t;
	float h1 = clamp((ro.y + rd.y * t - uMist.y) / uMist.z, -30.0, 80.0);
	return uMist.x * uMist.z * (exp(-h0) - exp(-h1)) / rd.y;
}

// Fog `col`, seen from ro along rd at distance t.
vec3 atmosphere(vec3 col, vec3 ro, vec3 rd, float t) {
	// Banks sampled at the end point and halfway: enough for a low, slow layer
	float banks = 0.5 * (mistBanks(ro.xz + rd.xz * t) + mistBanks(ro.xz + rd.xz * t * 0.5));
	float mist = mistDepth(ro, rd, t) * mix(1.0 - uMist.w, 1.0 + uMist.w, banks);
	float distanceFog = max(1.0 - exp(-t * uFogDensity), smoothstep(uFogEnd * 0.55, uFogEnd, t));
	float fog = 1.0 - (1.0 - distanceFog) * exp(-mist);
	return mix(col, fogColorToward(rd), fog);
}
