// Shading stage: the ground's colour at a Surface, before any fog (the composite pass adds the atmosphere).
// Needs /terrain, ./surface and ./shafts (sunVisibility).
// In linear light: the albedo maps are sRGB textures (the GPU decodes them), the colour uniforms are converted
// on upload. Unexposed (the composite applies Shading → Exposure), so the cache's 8 bits hold it (≤ 1).
// The sun's light: its angle on the slope, from the heightmap's normal (as sharp as the heights, whatever the
// maps' resolution), times its shadow. Inside the heightmap, the shadow, AO and cavity are the maps baked in
// Houdini (doc/formats/terrain-maps.md); beyond (far map, noise), the shadow ceiling's shadows (ridges, far
// mountains), blended with the maps across the band.
// One material, matte: the colour is albedo.png inside the heightmap (the fossils' colours painted in),
// faralbedo.png over the far map, else the tint, with a light variation from the noise texture.
// Near-gray on purpose: the mood is desaturated, colour is kept for meaning.
// Under the sea (terrainHeight below uSeaLevel), the water's own colour: shallow to deep with its depth, foam
// where it thins out at the shore; lit the same way (the maps are baked on the flattened terrain). The waves
// (reflection, glint) are the composite's: they move, the cache doesn't.

uniform sampler2D uMaps;      // R the sun's cast shadow (1: lit), G AO, B cavity: linear data
uniform vec3 uSunDir;         // toward the sun, the one used for the bake
uniform float uPixel;         // a pixel's angle in the cache (radians): the normal's footprint with distance
uniform vec3 uTint;           // the colour without albedo maps, and past them
uniform sampler2D uAlbedo;    // the colour inside the heightmap (an sRGB texture: linear when read), used if uAlbedoGrade.x
uniform sampler2D uFarAlbedo; // and over the far map, used if uAlbedoGrade.z
uniform vec3 uAlbedoGrade;    // x: 1 with an albedo map, 0 without; y: their saturation; z: 1 with a far albedo map
uniform vec3 uAlbedoTint;     // multiplies them (white: as exported)
uniform vec2 uDetail;         // x: colour variation, y: its size (world units)
uniform highp sampler3D uNoise; // gl/noise.ts: tileable gradient noise, sample with p / 8
uniform vec3 uShading;        // x: light in full shadow, y: AO strength, z: cavity strength
uniform vec3 uShallow;        // the water's colour where it's shallow
uniform vec3 uDeep;           // and where it's deep
uniform vec3 uWater;          // x: depth over which it turns deep (world units), y: foam, z: foam width (depth, world units)
uniform float uDebugView;     // dev (Light shafts → Debug view): 4 the ground's colour unlit

const vec3 FOAM = vec3(0.79, 0.83, 0.85); // linear: (0.9, 0.92, 0.93) as displayed

// An albedo map's colour as the panel grades it (Ground colours → Albedo saturation, Albedo tint)
vec3 gradeAlbedo(vec3 albedo) {
	return mix(vec3(dot(albedo, vec3(0.2126, 0.7152, 0.0722))), albedo, uAlbedoGrade.y) * uAlbedoTint;
}

vec3 shadeSurface(Surface s, vec3 rd) {
	// Sampled before branching: mipmapped lookups need the neighbouring pixels
	vec2 uv = terrainUv(s.position.xz);
	float mask = coreMask(s.position.xz);
	vec3 maps = texture(uMaps, uv).rgb;
	vec3 albedo = texture(uAlbedo, uv).rgb;
	vec3 farAlbedo = texture(uFarAlbedo, farUv(s.position.xz)).rgb;
	if (!s.hit) return vec3(0.0);

	vec3 p = s.position;
	vec3 normal = terrainNormal(p.xz, s.t * uPixel);
	if (mask < 1.0) {
		// Past the baked maps: the shadow ceiling's shadows, no AO, neutral cavity
		maps = mix(vec3(sunVisibility(p + vec3(0.0, 1.5, 0.0)), 1.0, 0.5), maps, mask);
	}
	float sun = max(dot(normal, uSunDir), 0.0) * maps.r; // the sun's angle on the slope, times its shadow
	float light = mix(uShading.x, 1.0, sun);
	float ao = mix(1.0, maps.g, uShading.y);
	float cavity = 1.0 + (maps.b - 0.5) * uShading.z;

	// The colour: the albedo map inside the heightmap, the far albedo map over the far map, else the tint, each
	// map fading out over its band; then a light variation
	vec3 colour = uTint;
	if (uAlbedoGrade.z > 0.0) colour = mix(colour, gradeAlbedo(farAlbedo), farMask(p.xz));
	if (uAlbedoGrade.x > 0.0) colour = mix(colour, gradeAlbedo(albedo), mask);
	if (uDetail.x > 0.0) {
		float size = max(uDetail.y, 0.1);
		float lod = log2(max(1.0, s.t * uPrecision * 8.0 / size)); // 8 texels per noise cell
		float n = textureLod(uNoise, vec3(p.xz / size, 0.37) / 8.0, lod).r;
		colour *= 1.0 + (n - 0.5) * 2.0 * uDetail.x;
	}

	// Dev view 4: the colour as the shader uses it, unlit, the sea ignored. The composite shows it without fog
	if (uDebugView > 3.5) return colour;
	vec3 col = colour * (light * ao * cavity);

	// Under the sea: the water. The shoreline blends over about a pixel, so it doesn't stair-step
	float depth = uSeaLevel - terrainHeight(p.xz);
	float edge = max(0.02, s.t * uPrecision);
	if (depth > -edge) {
		float wet = smoothstep(-edge, edge, depth);
		vec3 water = mix(uShallow, uDeep, 1.0 - exp(-max(depth, 0.0) / max(uWater.x, 0.01)));
		water = mix(water, FOAM, uWater.y * (1.0 - smoothstep(0.0, max(uWater.z, 0.01), depth)));
		col = mix(col, water * (light * ao), wet); // a flat surface: no cavities
	}
	return col;
}
