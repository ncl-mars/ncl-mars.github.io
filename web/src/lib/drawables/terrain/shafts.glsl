// Light shafts, march side: how much of the light scattered toward the eye along a view ray (by the mist and
// the haze) comes from air the sun reaches, through the ground's shadow volumes (the shadow ceiling,
// shadow.frag). Needs ./march (uSlab).
// Computed in the march and stored in the cache's alpha: the sun and the ground are fixed, so only the
// camera changes it, and a still view pays nothing. The composite (/fog's atmosphere) turns it into light
// and shade on the mist.

uniform sampler2D uShadow; // shadow ceiling, 0..1 over the slab (R8)
uniform vec4 uShadowBox;   // xy: min corner (world xz), zw: 1 / size
uniform vec4 uShaftMarch;  // x: samples per ray (0: off), y: edge softness (world units), z: fog density
uniform vec4 uMist;        // as in /fog: x density at the base, y base height (world), z falloff height

// 1 where the sun reaches p, 0 in the shadow of the ground; lit outside the shadow ceiling's box (faded)
float sunVisibility(vec3 p) {
	vec2 uv = (p.xz - uShadowBox.xy) * uShadowBox.zw;
	vec2 edge = min(uv, 1.0 - uv);
	float inside = smoothstep(0.0, 0.1, min(edge.x, edge.y));
	if (inside <= 0.0) return 1.0;
	float ceiling = mix(uSlab.x, uSlab.y, textureLod(uShadow, uv, 0.0).r);
	float soft = max(uShaftMarch.y, 1e-3);
	return mix(1.0, smoothstep(ceiling - soft, ceiling + soft, p.y), inside);
}

// Share of the light scattered toward the eye between ro and ro + rd · tEnd that comes from sunlit air:
// mist (dense low down) and haze (uniform), each weighted by how much of it reaches the eye.
// 1: no shadow on the way (or shafts off).
float shaftLight(vec3 ro, vec3 rd, float tEnd) {
	int samples = int(uShaftMarch.x);
	if (samples < 1) return 1.0;
	float haze = uShaftMarch.z;
	// Shadow only exists inside the ground's slab: sample that part of the ray
	float t0 = 0.0;
	float t1 = tEnd;
	if (abs(rd.y) > 1e-6) {
		float ta = (uSlab.y - ro.y) / rd.y;
		float tb = (uSlab.x - ro.y) / rd.y;
		t0 = max(t0, min(ta, tb));
		t1 = min(t1, max(ta, tb));
	} else if (ro.y < uSlab.x || ro.y > uSlab.y) {
		return 1.0;
	}
	if (t1 <= t0) return 1.0;

	// Samples denser near the eye (squared spacing), jittered per pixel so the steps read as fine grain
	float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
	float span = t1 - t0;
	float n = float(samples);
	float shadowed = 0.0;
	float inside = 0.0;
	float depth = haze * t0; // optical depth from the eye (the thin mist above the slab ignored)
	for (int i = 0; i < 64; i++) {
		if (i >= samples) break;
		float a = (float(i) + jitter) / n;
		float t = t0 + span * a * a;
		float dt = span * (2.0 * float(i) + 1.0) / (n * n);
		vec3 p = ro + rd * t;
		float density = uMist.x * exp(-(p.y - uMist.y) / uMist.z) + haze;
		float scatter = density * exp(-depth) * dt;
		depth += density * dt;
		shadowed += scatter * (1.0 - sunVisibility(p));
		inside += scatter;
	}
	// The haze outside the sampled part is all lit: before it, and after it up to tEnd (rays leaving upward)
	float outside = (1.0 - exp(-haze * t0)) + exp(-depth) * (1.0 - exp(-haze * max(tEnd - t1, 0.0)));
	float total = inside + outside;
	return total > 0.0 ? 1.0 - shadowed / total : 1.0;
}
