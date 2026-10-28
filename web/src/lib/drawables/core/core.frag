#version 300 es
precision highp float;
precision highp int;

// The core sample, raymarched: a solid of rock (./rock) whose cut face reveals the micro relief of the
// image at that depth. Raking light with soft shadows and occlusion, so the fine relief reads. Pixels that
// miss the core are discarded; hits write depth so the core composites with a scene.

#include ./rock;

uniform mat4 uInvMvp;     // clip → core local space
uniform mat4 uMvp;        // core local → clip (depth)
uniform vec3 uCamLocal;   // camera, in core local space
uniform vec3 uLightLocal; // raking light direction, local space
uniform int uSteps;       // march iteration cap
uniform float uStepScale; // fraction of the distance taken per step (the displaced top isn't exact)
uniform vec2 uShade;      // x: soft-shadow strength, y: occlusion strength

in vec2 vUv;
out vec4 outColor;

// Ray vs the core's bounds, padded for the displacements: (enter, exit)
vec2 boundsInterval(vec3 ro, vec3 rd) {
	float pad = uSideNoise.x + 0.002;
	vec3 lo = vec3(-0.5 - pad, uBottom, -0.5 - pad);
	vec3 hi = vec3(0.5 + pad, uCut + uTopNoise.x + uMicro + 0.002, 0.5 + pad);
	vec3 inv = 1.0 / rd;
	vec3 t0 = (lo - ro) * inv;
	vec3 t1 = (hi - ro) * inv;
	vec3 tNear = min(t0, t1);
	vec3 tFar = max(t0, t1);
	return vec2(max(max(tNear.x, tNear.y), max(tNear.z, 0.0)), min(min(tFar.x, tFar.y), tFar.z));
}

vec3 coreNormal(vec3 p) {
	const vec2 e = vec2(0.0012, 0.0);
	return normalize(vec3(
		sdCore(p + e.xyy) - sdCore(p - e.xyy),
		sdCore(p + e.yxy) - sdCore(p - e.yxy),
		sdCore(p + e.yyx) - sdCore(p - e.yyx)
	));
}

// Soft shadow toward the light. Starts off the surface, and only counts a blocker once the ray has left
// the surface's neighbourhood: the distance field is inexact on steep relief, and a sample grazing the
// surface it starts from must not shadow it (that drew dark stripes on the relief's flanks).
float softShadow(vec3 p, vec3 l) {
	float result = 1.0;
	float t = 0.01;
	for (int i = 0; i < 24; i++) {
		float d = sdCore(p + l * t);
		if (t > 0.03) result = min(result, 10.0 * max(d, 0.0) / t);
		if (result < 0.01) break;
		t += clamp(abs(d), 0.004, 0.08);
		if (t > 1.5) break;
	}
	return clamp(result, 0.0, 1.0);
}

float occlusion(vec3 p, vec3 n) {
	float o = 0.0;
	float w = 1.0;
	for (int i = 1; i <= 5; i++) {
		float h = 0.012 * float(i);
		o += (h - sdCore(p + n * h)) * w;
		w *= 0.6;
	}
	return clamp(1.0 - o * 12.0, 0.0, 1.0);
}

void main() {
	vec4 farLocal = uInvMvp * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
	vec3 ro = uCamLocal;
	vec3 rd = normalize(farLocal.xyz / farLocal.w - ro);

	vec2 span = boundsInterval(ro, rd);
	if (span.x >= span.y) discard;
	float t = span.x;
	float tOutside = t;
	bool hit = false;
	for (int i = 0; i < uSteps; i++) {
		float d = sdCore(ro + rd * t);
		if (d < 0.0) {
			// Overshot into the rock (steep relief): bisect back to the surface, keep the outside point
			float a = tOutside;
			float b = t;
			for (int j = 0; j < 10; j++) {
				float m = 0.5 * (a + b);
				if (sdCore(ro + rd * m) < 0.0) b = m;
				else a = m;
			}
			t = a;
			hit = true;
			break;
		}
		if (d < 0.0004 * t + 0.0002) {
			hit = true;
			break;
		}
		tOutside = t;
		t += d * uStepScale;
		if (t > span.y) break;
	}
	if (!hit) discard;

	vec3 p = ro + rd * t;
	vec3 n = coreNormal(p);
	float diffuse = max(dot(n, uLightLocal), 0.0);
	float shadow = diffuse > 0.0 ? mix(1.0, softShadow(p + n * 0.004, uLightLocal), uShade.x) : 1.0;
	float ao = mix(1.0, occlusion(p, n), uShade.y);
	vec3 col = rockColour(p) * (0.22 * ao + 0.85 * diffuse * shadow);

	vec4 clip = uMvp * vec4(p, 1.0);
	gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
	outColor = vec4(col, 1.0);
}
