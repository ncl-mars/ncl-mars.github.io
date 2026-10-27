// Surface stage: where a view ray first hits the heightfield. Needs /terrain and ./surface.
// Strategy: height-relative steps inside the terrain's box. Far above the ground the ray takes big steps,
// near it small ones (step = uStepScale × clearance, at least the pixel footprint), then a binary search
// once a sample lands below ground. Steep rays (zoomed out) converge in a few steps; grazing rays (zoomed
// in, camera tilted up) stay accurate. A max-mip or cone-step strategy would replace marchSurface() and
// keep the same signature.

uniform int uSteps;        // iteration cap
uniform int uRefineSteps;  // binary-search steps after the first sample below ground
uniform float uStepScale;  // fraction of the clearance to step (< 1: steep slopes would be overshot)
uniform float uPrecision;  // minimum step and hit tolerance, relative to the distance (~ pixel footprint)

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
