// Shading stage: the ground's material colour at a Surface, before any fog (the composite pass adds the
// atmosphere). Needs /terrain, ./surface and ./shafts (sunVisibility).
// Inside the heightmap: the maps baked in Houdini (doc/formats/terrain-maps.md). Beyond (far map, noise):
// light from the same sun, its shadows from the shadow ceiling (ridges, far mountains), blended with the
// baked maps across the band. Near-gray on purpose: the mood is desaturated, colour is kept for meaning.
// Under the sea (terrainHeight below uSeaLevel), the water's own colour: shallow to deep with its depth,
// foam where it thins out at the shore; lit the same way (the maps are baked on the flattened terrain).
// The waves (reflection, glint) are the composite's: they move, the cache doesn't.

uniform sampler2D uMaps;    // R direct light (sun + shadows), G AO, B cavity: linear data
uniform vec3 uSunDir;       // toward the sun, the one used for the bake
uniform vec3 uTint;         // ground tint, near gray
uniform vec4 uShading;      // x: light in full shadow, y: AO strength, z: cavity strength, w: exposure
uniform vec3 uShallow;      // the water's colour where it's shallow
uniform vec3 uDeep;         // and where it's deep
uniform vec3 uWater;        // x: depth over which it turns deep (world units), y: foam, z: foam width (depth, world units)

const vec3 FOAM = vec3(0.9, 0.92, 0.93);

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

	// Under the sea: the water. The shoreline blends over about a pixel, so it doesn't stair-step
	vec3 albedo = uTint;
	float depth = uSeaLevel - terrainHeight(s.position.xz);
	float edge = max(0.02, s.t * uPrecision);
	if (depth > -edge) {
		float wet = smoothstep(-edge, edge, depth);
		vec3 water = mix(uShallow, uDeep, 1.0 - exp(-max(depth, 0.0) / max(uWater.x, 0.01)));
		water = mix(water, FOAM, uWater.y * (1.0 - smoothstep(0.0, max(uWater.z, 0.01), depth)));
		albedo = mix(albedo, water, wet);
		cavity = mix(cavity, 1.0, wet); // a flat surface: no cavities
	}
	return albedo * (light * ao * cavity * uShading.w);
}
