// Shading stage: colours a Surface from the maps baked in Houdini (doc/formats/terrain-maps.md).
// Needs /terrain and ./surface. Near-gray on purpose: the mood is desaturated, colour is kept for meaning.

uniform sampler2D uMaps;  // R direct light (sun + shadows), G AO, B cavity: linear data
uniform vec3 uSunDir;     // toward the sun, the one used for the bake (pits will use it in M3)
uniform vec3 uTint;       // ground tint, near gray
uniform vec4 uShading;    // x: light in full shadow, y: AO strength, z: cavity strength, w: exposure
uniform vec3 uFogColor;   // also the sky; M2b replaces this with the real mist
uniform float uFogDensity;

vec3 shadeSurface(Surface s, vec3 rd) {
	// Sampled before branching: mipmapped lookups need the derivatives of neighbouring pixels
	vec3 maps = texture(uMaps, terrainUv(s.position.xz)).rgb;
	if (!s.hit) return uFogColor;

	float light = mix(uShading.x, 1.0, maps.r);
	float ao = mix(1.0, maps.g, uShading.y);
	float cavity = 1.0 + (maps.b - 0.5) * uShading.z;
	vec3 col = uTint * (light * ao * cavity * uShading.w);

	float fog = 1.0 - exp(-s.t * uFogDensity);
	return mix(col, uFogColor, fog);
}
