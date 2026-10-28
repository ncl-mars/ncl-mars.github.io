// Surface stage: where a view ray first hits the ground. Needs /terrain and ./surface.
// The ground is endless (heightmap + far field), so the search is bounded only by its height range (the
// slab) and the fog end distance, past which nothing is visible anyway.
// Strategy: height-relative steps. Far above the ground the ray takes big steps, near it small ones
// (step = uStepScale × clearance, at least the pixel footprint), then a binary search once a sample lands
// below ground. Steep rays converge in a few steps; grazing rays stay accurate. A max-mip or cone-step
// strategy would replace marchSurface() and keep the same signature.

uniform int uSteps;        // iteration cap
uniform int uRefineSteps;  // binary-search steps after the first sample below ground
uniform float uStepScale;  // fraction of the clearance to step (< 1: steep slopes would be overshot)
uniform float uPrecision;  // minimum step and hit tolerance, relative to the distance (~ pixel footprint)
uniform vec2 uSlab;        // height range of the whole ground (min, max)
uniform float uMaxDistance; // fog end: nothing is searched beyond

// Ray vs the ground's height slab, capped at uMaxDistance: (tEnter, tExit), tEnter >= tExit when it misses.
vec2 slabInterval(vec3 ro, vec3 rd) {
	if (abs(rd.y) < 1e-6) {
		bool inside = ro.y >= uSlab.x && ro.y <= uSlab.y;
		return inside ? vec2(0.0, uMaxDistance) : vec2(1.0, 0.0);
	}
	float t0 = (uSlab.y - ro.y) / rd.y;
	float t1 = (uSlab.x - ro.y) / rd.y;
	return vec2(max(min(t0, t1), 0.0), min(max(t0, t1), uMaxDistance));
}

Surface marchSurface(vec3 ro, vec3 rd) {
	Surface s = Surface(false, vec3(0.0), 0.0);
	vec2 span = slabInterval(ro, rd);
	if (span.x >= span.y) return s;

	float t = span.x;
	float tAbove = span.x;
	for (int i = 0; i < uSteps; i++) {
		vec3 p = ro + rd * t;
		float clearance = p.y - height(p.xz);
		if (clearance <= 0.0) {
			// The surface is between tAbove (above ground) and t (below): bisect
			float a = tAbove;
			float b = t;
			for (int j = 0; j < uRefineSteps; j++) {
				float m = 0.5 * (a + b);
				vec3 q = ro + rd * m;
				if (q.y <= height(q.xz)) b = m;
				else a = m;
			}
			t = 0.5 * (a + b);
			s.hit = true;
			break;
		}
		if (clearance < t * uPrecision) {
			s.hit = true; // closer than a pixel: good enough
			break;
		}
		tAbove = t;
		t += max(clearance * uStepScale, t * uPrecision);
		if (t > span.y) break;
	}
	s.t = t;
	s.position = ro + rd * t;
	return s;
}
