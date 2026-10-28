// Shading stage: colours a Surface. Needs /terrain and ./surface.
// Inside the heightmap: the maps baked in Houdini (doc/formats/terrain-maps.md). On the far field: plain
// light from the same sun, blended with the baked maps across the band. Near-gray on purpose: the mood is
// desaturated, colour is kept for meaning. Fog reaches full opacity at uFogEnd and the sky is the fog
// colour, so the ground has no visible end.

uniform sampler2D uMaps;    // R direct light (sun + shadows), G AO, B cavity: linear data
uniform vec3 uSunDir;       // toward the sun, the one used for the bake
uniform vec3 uTint;         // ground tint, near gray
uniform vec4 uShading;      // x: light in full shadow, y: AO strength, z: cavity strength, w: exposure
uniform vec3 uFogColor;     // horizon and fog (and the page background, so nothing has an edge)
uniform vec3 uSkyColor;     // sky overhead, above the horizon fog
uniform float uFogDensity;
uniform float uFogEnd;      // fully fogged from here (also where the march stops)

vec3 skyColor(vec3 rd) {
	return mix(uFogColor, uSkyColor, smoothstep(0.0, 0.45, rd.y));
}

vec3 shadeSurface(Surface s, vec3 rd) {
	// Sampled before branching: mipmapped lookups need the derivatives of neighbouring pixels
	vec3 maps = texture(uMaps, terrainUv(s.position.xz)).rgb;
	if (!s.hit) return skyColor(rd);

	float mask = coreMask(s.position.xz);
	if (mask < 1.0) {
		// Far field: sun light, no AO, neutral cavity
		vec3 farMaps = vec3(max(dot(terrainNormal(s.position.xz), uSunDir), 0.0), 1.0, 0.5);
		maps = mix(farMaps, maps, mask);
	}

	float light = mix(uShading.x, 1.0, maps.r);
	float ao = mix(1.0, maps.g, uShading.y);
	float cavity = 1.0 + (maps.b - 0.5) * uShading.z;
	vec3 col = uTint * (light * ao * cavity * uShading.w);

	float fog = max(1.0 - exp(-s.t * uFogDensity), smoothstep(uFogEnd * 0.55, uFogEnd, s.t));
	return mix(col, uFogColor, fog);
}
