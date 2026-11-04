// Shading stage: the ground's material colour at a Surface, before any fog (the composite pass adds the
// atmosphere). Needs /terrain, ./surface and ./shafts (sunVisibility).
// The sun's light: its angle on the slope, from the heightmap's normal (as sharp as the heights, whatever the
// maps' resolution), times its shadow. Inside the heightmap, the shadow, AO and cavity are the maps baked in
// Houdini (doc/formats/terrain-maps.md); beyond (far map, noise), the shadow ceiling's shadows (ridges, far
// mountains), blended with the maps across the band.
// Materials (materials.png: three soft masks from Houdini, R metal, G gloss, B spare, the ground the rest):
// where the masks are steep (an edge, blurred over a few texels), the largest weight wins, anti-aliased, so the
// edges stay crisp at any zoom; where they ramp gently (sand drifting over a ring), they blend by their values.
// Metal, gloss and spare reflect the sky and the sun's highlight (a colour, how metallic, how rough: the panel's
// Materials); they depend on the view, which re-marches the cache anyway. The ground is matte: albedo.png
// inside the heightmap (rock painted in), else the tint, with a light variation from the noise texture.
// Near-gray on purpose: the mood is desaturated, colour is kept for meaning.
// Under the sea (terrainHeight below uSeaLevel), the water's own colour, whatever the material: shallow to
// deep with its depth, foam where it thins out at the shore; lit the same way (the maps are baked on the
// flattened terrain). The waves (reflection, glint) are the composite's: they move, the cache doesn't.

uniform sampler2D uMaps;      // R the sun's cast shadow (1: lit), G AO, B cavity: linear data
uniform vec3 uSunDir;         // toward the sun, the one used for the bake
uniform float uPixel;         // a pixel's angle in the cache (radians): the normal's footprint with distance
uniform vec3 uTint;           // the ground's colour without an albedo map, and past the heightmap
uniform sampler2D uAlbedo;    // the ground's colour inside the heightmap (display values), used if uAlbedoGrade.x
uniform vec2 uAlbedoGrade;    // x: 1 with an albedo map, 0 without; y: its saturation
uniform vec3 uAlbedoTint;     // multiplies it (white: as exported)
uniform vec2 uDetail;         // x: colour variation, y: its size (world units)
uniform highp sampler3D uNoise; // gl/noise.ts: tileable gradient noise, sample with p / 8
uniform sampler2D uMaterials; // R metal, G gloss, B spare: soft masks (doc/formats/terrain-maps.md); black without
uniform float uMaterialEdge;  // their edges' softness, in mask units (at least a pixel, for anti-aliasing)
uniform float uMaterialBlend; // a ramp in the masks this many texels wide is half an edge, half a blend
uniform vec3 uMetal;          // each material's colour, then x: how metallic, y: how rough
uniform vec2 uMetalSurface;
uniform vec3 uGloss;
uniform vec2 uGlossSurface;
uniform vec3 uSpare;
uniform vec2 uSpareSurface;
uniform vec3 uFogColor;       // what they reflect: the sky as /fog draws it
uniform vec3 uSkyColor;
uniform vec3 uSunColor;
uniform vec2 uSunGlow;        // x: strength, y: tightness
uniform vec4 uShading;        // x: light in full shadow, y: AO strength, z: cavity strength, w: exposure
uniform vec3 uShallow;        // the water's colour where it's shallow
uniform vec3 uDeep;           // and where it's deep
uniform vec3 uWater;          // x: depth over which it turns deep (world units), y: foam, z: foam width (depth, world units)
uniform float uDebugView;     // dev (Light shafts → Debug view): 3 the materials in flat colours, 4 the ground's colour unlit

const vec3 FOAM = vec3(0.9, 0.92, 0.93);

// The largest of three weights wins, anti-aliased against the runner-up over `aa`, so where three materials meet,
// none leaves a gap
vec3 largestWins(vec3 w, float aa) {
	vec3 share = smoothstep(-aa, aa, w - vec3(max(w.y, w.z), max(w.x, w.z), max(w.x, w.y)));
	return share / max(share.x + share.y + share.z, 1e-4);
}

// Each material's share (ground, metal, gloss, spare) from the masks m at uv, on two levels: the objects (metal,
// gloss and spare together, so an object's outline is their union) against the ground, then each material within
// the objects (a gem in a ring, under the same sand). On each, where the values are steep (an edge, blurred over
// a few texels), the largest wins, anti-aliased, crisp at any zoom; where they ramp gently, they blend by their
// values, as painted. Takes derivatives: call it before branching
vec4 materialShares(vec2 uv, vec3 m) {
	float objects = m.r + m.g + m.b;
	vec4 v = vec4(objects, m / max(objects, 1e-4)); // the objects, then each material's share of them
	// Their slopes in texels: their gradients on screen, back through uv's (tx, ty: texels per pixel along the
	// screen's x and y)
	vec2 size = vec2(textureSize(uMaterials, 0));
	vec2 tx = dFdx(uv) * size, ty = dFdy(uv) * size;
	vec4 dx = dFdx(v), dy = dFdy(v);
	vec4 gu = ty.y * dx - tx.y * dy, gv = tx.x * dy - ty.x * dx;
	vec4 slope = sqrt(gu * gu + gv * gv) / max(abs(tx.x * ty.y - tx.y * ty.x), 1e-20);
	// 0: a gentle ramp, blended; 1: an edge, the largest wins. A ramp uMaterialBlend texels wide is half of each
	vec2 steep = smoothstep(0.5, 1.5, vec2(slope.x, max(slope.y, max(slope.z, slope.w))) * uMaterialBlend);
	// An edge is at least this soft: a pixel and a half, anti-aliased at any zoom
	vec4 fw = fwidth(v);
	float aaObjects = max(max(fw.x * 1.5, uMaterialEdge), 1e-4);
	float aaWithin = max(max(max(fw.y, max(fw.z, fw.w)) * 1.5, uMaterialEdge), 1e-4);
	float shown = mix(objects, smoothstep(-aaObjects, aaObjects, 2.0 * objects - 1.0), steep.x);
	return vec4(1.0 - shown, shown * mix(v.yzw, largestWins(v.yzw, aaWithin), steep.y));
}

// What metal and gloss reflect: the sky as /fog's skyColor draws it (the horizon's fog, brighter toward the
// sun, the sky overhead; mirror it), and below the horizon the ground, as a dim average (no reflection march)
vec3 environment(vec3 r) {
	vec3 horizon = uFogColor + uSunColor * uSunGlow.x * pow(max(dot(r, uSunDir), 0.0), uSunGlow.y);
	vec3 sky = mix(horizon, uSkyColor, smoothstep(0.0, 0.45, r.y));
	return mix(uTint * uShading.x, sky, smoothstep(-0.15, 0.05, r.y));
}

// Metal, gloss, spare: a diffuse base (none for a metal) under the reflected sky and the sun's highlight
// (normalised Blinn-Phong, Schlick's Fresnel). surface: x how metallic, y how rough
vec3 shadeMaterial(vec3 colour, vec2 surface, vec3 n, vec3 v, float sun, float light, float ao, float cavity) {
	float metallic = clamp(surface.x, 0.0, 1.0);
	float roughness = clamp(surface.y, 0.05, 1.0);
	vec3 f0 = mix(vec3(0.04), colour, metallic);
	vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - max(dot(n, v), 0.0), 5.0);
	// A rough surface reflects toward its normal: the sky's average rather than one direction
	vec3 r = normalize(mix(reflect(-v, n), n, roughness * roughness));
	vec3 h = normalize(v + uSunDir);
	float shininess = max(2.0 / (roughness * roughness) - 2.0, 1.0);
	float highlight = (shininess + 8.0) / 25.1327 * pow(max(dot(n, h), 0.0), shininess); // / 8π
	vec3 glint = f0 + (1.0 - f0) * pow(1.0 - max(dot(v, h), 0.0), 5.0);
	vec3 specular = fresnel * environment(r) * ao + glint * uSunColor * (highlight * sun);
	vec3 diffuse = colour * (1.0 - metallic) * (light * ao * cavity);
	return diffuse * (1.0 - fresnel) + specular;
}

vec3 shadeSurface(Surface s, vec3 rd) {
	// Sampled before branching: mipmapped lookups and derivatives need the neighbouring pixels
	vec2 uv = terrainUv(s.position.xz);
	float mask = coreMask(s.position.xz);
	vec3 maps = texture(uMaps, uv).rgb;
	vec3 albedo = texture(uAlbedo, uv).rgb;
	// Ground, metal, gloss, spare; the masks faded out with the heightmap: ground past its edges
	vec4 share = materialShares(uv, texture(uMaterials, uv).rgb * mask);
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

	// The ground: the albedo map inside the heightmap, else the tint; then a light variation
	vec3 ground = uTint;
	if (uAlbedoGrade.x > 0.0) {
		vec3 graded = mix(vec3(dot(albedo, vec3(0.2126, 0.7152, 0.0722))), albedo, uAlbedoGrade.y) * uAlbedoTint;
		ground = mix(ground, graded, mask);
	}
	if (uDetail.x > 0.0) {
		float size = max(uDetail.y, 0.1);
		float lod = log2(max(1.0, s.t * uPrecision * 8.0 / size)); // 8 texels per noise cell
		float n = textureLod(uNoise, vec3(p.xz / size, 0.37) / 8.0, lod).r;
		ground *= 1.0 + (n - 0.5) * 2.0 * uDetail.x;
	}

	if (uDebugView > 2.5) {
		// Dev views: 3 each material in a flat colour (ground grey, metal yellow, gloss blue, spare green), lit just
		// enough to read the relief; 4 the ground's colour as the shader uses it, unlit, the materials and the sea
		// ignored. The composite shows them without fog
		if (uDebugView > 3.5) return ground;
		vec3 swatch = share.x * vec3(0.5) + share.y * vec3(1.0, 0.8, 0.2) + share.z * vec3(0.2, 0.45, 1.0) + share.w * vec3(0.3, 0.8, 0.3);
		return swatch * (0.4 + 0.6 * sun);
	}
	vec3 col = share.x * ground * (light * ao * cavity);
	if (share.x < 1.0) {
		vec3 v = -rd;
		col += share.y * shadeMaterial(uMetal, uMetalSurface, normal, v, sun, light, ao, cavity);
		col += share.z * shadeMaterial(uGloss, uGlossSurface, normal, v, sun, light, ao, cavity);
		col += share.w * shadeMaterial(uSpare, uSpareSurface, normal, v, sun, light, ao, cavity);
	}

	// Under the sea: the water, whatever the material. The shoreline blends over about a pixel, so it doesn't
	// stair-step
	float depth = uSeaLevel - terrainHeight(p.xz);
	float edge = max(0.02, s.t * uPrecision);
	if (depth > -edge) {
		float wet = smoothstep(-edge, edge, depth);
		vec3 water = mix(uShallow, uDeep, 1.0 - exp(-max(depth, 0.0) / max(uWater.x, 0.01)));
		water = mix(water, FOAM, uWater.y * (1.0 - smoothstep(0.0, max(uWater.z, 0.01), depth)));
		col = mix(col, water * (light * ao), wet); // a flat surface: no cavities
	}
	return col * uShading.w;
}
