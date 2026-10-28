#version 300 es
precision highp float;

// The core's shell in X-ray: glowing edges, a faint rim, and on the walls the strata, where each
// layer's dipping plane meets the wall (a bright line) with alternating bands between them.
// Additive (alpha 0), so it never needs sorting.

#define MAX_LAYERS 16

uniform int uLayerCount;
uniform float uLayerBase[MAX_LAYERS];
uniform vec2 uLayerSlope[MAX_LAYERS];
uniform vec3 uShellSize;
uniform float uShellCenterY;
uniform vec3 uCamLocal;
uniform vec3 uXrayColor;
uniform float uXray; // overall X-ray strength

in vec3 vLocal;
out vec4 outColor;

void main() {
	vec3 extent = uShellSize * 0.5;
	vec3 d = extent - abs(vLocal - vec3(0.0, uShellCenterY, 0.0)); // distance to each pair of faces
	// On an edge of the prism when two of the three distances are small: take the middle one
	float middle = d.x + d.y + d.z - min(d.x, min(d.y, d.z)) - max(d.x, max(d.y, d.z));
	float edge = 1.0 - smoothstep(0.0, 0.012, middle);

	vec3 n = normalize(cross(dFdx(vLocal), dFdy(vLocal)));
	vec3 v = normalize(uCamLocal - vLocal);
	float rim = pow(1.0 - abs(dot(n, v)), 2.5);

	float lines = 0.0;
	float below = 0.0;
	for (int k = 0; k < MAX_LAYERS; k++) {
		if (k >= uLayerCount) break;
		float dy = vLocal.y - (uLayerBase[k] + dot(uLayerSlope[k], vLocal.xz));
		lines = max(lines, 1.0 - smoothstep(0.0, 0.008, abs(dy)));
		below += step(0.0, dy);
	}
	float wall = 1.0 - abs(n.y); // strata only on the walls, not the caps
	float band = mod(below, 2.0) * 0.05;

	float glow = edge * 0.9 + rim * 0.22 + (lines * 0.55 + band) * wall + 0.015;
	outColor = vec4(uXrayColor * glow * uXray, 0.0);
}
