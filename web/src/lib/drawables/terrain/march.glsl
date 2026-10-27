// Surface stage: where a view ray first hits the heightfield. Needs /terrain and ./surface.
// Strategy now: fixed steps across the part of the ray inside the terrain's box, then a binary search.
// The survey camera keeps rays steep, so the box crossing is short. A max-mip or cone-step strategy
// would replace marchSurface() and keep the same signature.

uniform int uSteps;       // fixed steps across the box crossing
uniform int uRefineSteps; // binary-search steps after the first sample below ground

// Ray vs the terrain's world box: (tEnter, tExit), with tEnter >= tExit when it misses.
vec2 boundsInterval(vec3 ro, vec3 rd) {
	vec3 inv = 1.0 / rd;
	vec3 t0 = (uBoundsMin - ro) * inv;
	vec3 t1 = (uBoundsMax - ro) * inv;
	vec3 tNear = min(t0, t1);
	vec3 tFar = max(t0, t1);
	float enter = max(max(tNear.x, tNear.y), max(tNear.z, 0.0));
	float exit = min(min(tFar.x, tFar.y), tFar.z);
	return vec2(enter, exit);
}

Surface marchSurface(vec3 ro, vec3 rd) {
	Surface s = Surface(false, vec3(0.0), 0.0);
	vec2 span = boundsInterval(ro, rd);
	if (span.x >= span.y) return s;

	float dt = (span.y - span.x) / float(uSteps);
	float tAbove = span.x;
	for (int i = 1; i <= uSteps; i++) {
		float t = span.x + dt * float(i);
		vec3 p = ro + rd * t;
		if (p.y <= height(p.xz)) {
			// The surface is between tAbove (above ground) and t (below): bisect
			float a = tAbove;
			float b = t;
			for (int j = 0; j < uRefineSteps; j++) {
				float m = 0.5 * (a + b);
				vec3 q = ro + rd * m;
				if (q.y <= height(q.xz)) b = m;
				else a = m;
			}
			s.hit = true;
			s.t = 0.5 * (a + b);
			s.position = ro + rd * s.t;
			return s;
		}
		tAbove = t;
	}
	return s;
}
