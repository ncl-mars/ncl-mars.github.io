// Shading stage: the ground's material colour at a Surface, before any fog (the composite pass adds the
// atmosphere). Needs /terrain, ./surface and ./shafts (sunVisibility).
// Inside the heightmap: the maps baked in Houdini (doc/formats/terrain-maps.md). Beyond (far map, noise):
// light from the same sun, its shadows from the shadow ceiling (ridges, far mountains), blended with the
// baked maps across the band. Near-gray on purpose: the mood is desaturated, colour is kept for meaning.

uniform sampler2D uMaps;    // R direct light (sun + shadows), G AO, B cavity: linear data
uniform vec3 uSunDir;       // toward the sun, the one used for the bake
uniform vec3 uTint;         // ground tint, near gray
uniform vec4 uShading;      // x: light in full shadow, y: AO strength, z: cavity strength, w: exposure

vec3 shadeSurface(Surface s) {
	// Sampled before branching: mipmapped lookups need the derivatives of neighbouring pixels
	vec3 maps = texture(uMaps, terrainUv(s.position.xz)).rgb;
	if (!s.hit) return vec3(0.0);

	float mask = coreMask(s.position.xz);
	if (mask < 1.0) {
		// Past the baked maps: sun light and the shadow ceiling's shadows, no AO, neutral cavity
		vec3 p = s.position;
		float sun = max(dot(terrainNormal(p.xz), uSunDir), 0.0) * sunVisibility(p + vec3(0.0, 1.5, 0.0));
		maps = mix(vec3(sun, 1.0, 0.5), maps, mask);
	}

	float light = mix(uShading.x, 1.0, maps.r);
	float ao = mix(1.0, maps.g, uShading.y);
	float cavity = 1.0 + (maps.b - 0.5) * uShading.z;
	return uTint * (light * ao * cavity * uShading.w);
}
