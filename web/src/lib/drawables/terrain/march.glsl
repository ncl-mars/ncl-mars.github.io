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
uniform float uFineBand;   // the fine reads within this of the ground (world units, plus a pixel's height)

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

	// Both stops end exactly on the surface (on a plane; very close on real terrain), from clearances already
	// measured: later passes rebuild the ground from this depth (shadows on the ground, the sea), and a gap
	// that jumps from band to band across a slope would show in them as stairs.
	// The big steps read the heights as the GPU filters them (one read, bilinear); within uFineBand of the
	// ground, the fine ones (the B-spline, /terrain; four reads). The B-spline rises above the bilinear surface
	// where it fills narrow dips (by up to 0.5 m on 99.99 % of the site): where that rise passes about 3/4 of the
	// band, a step can cross into the dip, and the hit lands slightly inside it. 0.8 m leaves about 0.008 % of
	// the site's ground to that.
	float nearGround = uFineBand;
	float t = span.x;
	float tAbove = span.x;
	float cAbove = -1.0; // clearance at tAbove; < 0: not measured yet
	for (int i = 0; i < uSteps; i++) {
		vec3 p = ro + rd * t;
		float clearance = p.y - height(p.xz);
		if (uExactHeights > 0.5 && clearance < nearGround + t * uPrecision) clearance = p.y - heightExact(p.xz);
		if (clearance <= 0.0) {
			// The surface is between tAbove (above ground) and t (below): bisect, then where the clearance
			// crosses zero in the last bracket
			float a = tAbove;
			float b = t;
			float ca = cAbove;
			float cb = clearance;
			for (int j = 0; j < uRefineSteps; j++) {
				float m = 0.5 * (a + b);
				vec3 q = ro + rd * m;
				float cm = q.y - heightExact(q.xz);
				if (cm <= 0.0) {
					b = m;
					cb = cm;
				} else {
					a = m;
					ca = cm;
				}
			}
			t = ca > 0.0 ? a + (b - a) * ca / (ca - cb) : 0.5 * (a + b);
			s.hit = true;
			break;
		}
		if (clearance < t * uPrecision) {
			// Closer than a pixel's height: one secant step onto the surface, from the previous sample (at most
			// as far again as the last step)
			if (cAbove > clearance) t += min(clearance * (t - tAbove) / (cAbove - clearance), t - tAbove);
			s.hit = true;
			break;
		}
		tAbove = t;
		cAbove = clearance;
		t += max(clearance * uStepScale, t * uPrecision);
		if (t > span.y) break;
	}
	s.t = t;
	s.position = ro + rd * t;
	return s;
}
