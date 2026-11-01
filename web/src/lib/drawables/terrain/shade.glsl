// Shading stage: the ground's material colour at a Surface, before any fog (the composite pass adds the
// atmosphere). Needs /terrain, ./surface and ./shafts (sunVisibility).
// The sun's light: its angle on the slope, from the heightmap's normal (as sharp as the heights, whatever the
// maps' resolution), times its shadow. Inside the heightmap, the shadow, AO and cavity are the maps baked in
// Houdini (doc/formats/terrain-maps.md); beyond (far map, noise), the shadow ceiling's shadows (ridges, far
// mountains), blended with the maps across the band. Near-gray on purpose: the mood is desaturated, colour
// is kept for meaning.
// The ground's colour: the tint, under the zones (three soft masks from Houdini, each crisp at any zoom by
// thresholding it at 0.5, B over G over R), under rock on steep slopes, with a light variation from the noise
// texture so large zones aren't flat.
// Under the sea (terrainHeight below uSeaLevel), the water's own colour: shallow to deep with its depth,
// foam where it thins out at the shore; lit the same way (the maps are baked on the flattened terrain).
// The waves (reflection, glint) are the composite's: they move, the cache doesn't.

uniform sampler2D uMaps;    // R the sun's cast shadow (1: lit), G AO, B cavity: linear data
uniform vec3 uSunDir;       // toward the sun, the one used for the bake
uniform float uPixel;       // a pixel's angle in the cache (radians): the normal's footprint with distance
uniform vec3 uTint;         // ground tint, near gray: where no zone and no rock
uniform sampler2D uZones;   // R, G, B: three zones' soft masks (doc/formats/terrain-maps.md); black without
uniform vec3 uZone1;        // their colours
uniform vec3 uZone2;
uniform vec3 uZone3;
uniform float uZoneEdge;    // the masks' edge softness, in mask units (at least a pixel, for anti-aliasing)
uniform vec4 uRock;         // rgb: rock's colour; a: how much (0: none)
uniform vec2 uRockSlope;    // x: the slope where rock takes over (degrees), y: over how many degrees
uniform vec2 uDetail;       // x: colour variation, y: its size (world units)
uniform highp sampler3D uNoise; // gl/noise.ts: tileable gradient noise, sample with p / 8
uniform vec4 uShading;      // x: light in full shadow, y: AO strength, z: cavity strength, w: exposure
uniform vec3 uShallow;      // the water's colour where it's shallow
uniform vec3 uDeep;         // and where it's deep
uniform vec3 uWater;        // x: depth over which it turns deep (world units), y: foam, z: foam width (depth, world units)

const vec3 FOAM = vec3(0.9, 0.92, 0.93);

// A zone mask's edge (its 0.5 level), softened over `w` mask units
float zoneEdge(float m, float w) {
	return smoothstep(0.5 - w, 0.5 + w, m);
}

vec3 shadeSurface(Surface s) {
	// Sampled before branching: mipmapped lookups and fwidth need the neighbouring pixels
	vec2 uv = terrainUv(s.position.xz);
	vec3 maps = texture(uMaps, uv).rgb;
	vec3 zones = texture(uZones, uv).rgb;
	vec3 pixel = fwidth(zones) * 0.75; // a zone edge is at least this soft: anti-aliased at any zoom
	if (!s.hit) return vec3(0.0);

	vec3 p = s.position;
	vec3 normal = terrainNormal(p.xz, s.t * uPixel);
	float mask = coreMask(p.xz);
	if (mask < 1.0) {
		// Past the baked maps: the shadow ceiling's shadows, no AO, neutral cavity
		maps = mix(vec3(sunVisibility(p + vec3(0.0, 1.5, 0.0)), 1.0, 0.5), maps, mask);
	}

	float light = mix(uShading.x, 1.0, max(dot(normal, uSunDir), 0.0) * maps.r);
	float ao = mix(1.0, maps.g, uShading.y);
	float cavity = 1.0 + (maps.b - 0.5) * uShading.z;

	// The ground's colour: the zones over the tint (they fade out with the heightmap, past its edges), rock
	// over them on steep slopes, then a light variation
	zones *= mask;
	vec3 albedo = uTint;
	albedo = mix(albedo, uZone1, zoneEdge(zones.r, max(pixel.r, uZoneEdge)));
	albedo = mix(albedo, uZone2, zoneEdge(zones.g, max(pixel.g, uZoneEdge)));
	albedo = mix(albedo, uZone3, zoneEdge(zones.b, max(pixel.b, uZoneEdge)));
	if (uRock.a > 0.0) {
		float slope = degrees(acos(clamp(normal.y, 0.0, 1.0)));
		albedo = mix(albedo, uRock.rgb, uRock.a * smoothstep(uRockSlope.x - uRockSlope.y, uRockSlope.x + uRockSlope.y, slope));
	}
	if (uDetail.x > 0.0) {
		float size = max(uDetail.y, 0.1);
		float lod = log2(max(1.0, s.t * uPrecision * 8.0 / size)); // 8 texels per noise cell
		float n = textureLod(uNoise, vec3(p.xz / size, 0.37) / 8.0, lod).r;
		albedo *= 1.0 + (n - 0.5) * 2.0 * uDetail.x;
	}

	// Under the sea: the water. The shoreline blends over about a pixel, so it doesn't stair-step
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
