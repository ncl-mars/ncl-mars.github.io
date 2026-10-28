#version 300 es
precision highp float;
precision highp int; // the noise hash needs 32-bit integers (fragment ints default to mediump)

// A relief stratum, between two looks blended by uFocus, with one premultiplied blend mode:
// - X-ray (uFocus 0): the relief's silhouettes glow like a radiograph; alpha 0 = additive, order-free.
// - Developed (uFocus 1): mineral relief under a raking light, opaque; alpha 1 hides what's behind.
// Normals come from the relief texture per pixel, so the lighting stays sharp on a coarse grid.

#include /noise;
#include ./core;

uniform vec3 uCamLocal;   // camera, in the core's local space
uniform vec3 uLightLocal; // raking light direction, local space
uniform float uFocus;     // 0 X-ray → 1 developed
uniform float uGhost;     // X-ray strength for this layer (fades away from the reading depth)
uniform vec3 uXrayColor;
uniform vec3 uMineral;

in vec2 vUv;
in vec3 vLocal;
out vec4 outColor;

void main() {
	// One relief texel, in layer uv
	vec2 e = uImageRect.zw / vec2(textureSize(uRelief, 0));
	float du = (reliefAt(vUv + vec2(e.x, 0.0)) - reliefAt(vUv - vec2(e.x, 0.0))) / (2.0 * e.x);
	float dv = (reliefAt(vUv + vec2(0.0, e.y)) - reliefAt(vUv - vec2(0.0, e.y))) / (2.0 * e.y);
	vec3 n = normalize(vec3(-(uSlope.x + uAmp * du), 1.0, -(uSlope.y + uAmp * dv)));
	vec3 v = normalize(uCamLocal - vLocal);

	// Developed: stone relief under a raking light, with a fine mineral grain
	float grain = valueNoise(vUv * 140.0) * 0.6 + valueNoise(vUv * 37.0) * 0.4;
	float light = 0.2 + 0.8 * max(dot(n, uLightLocal), 0.0);
	vec3 lit = uMineral * light * (0.86 + 0.28 * grain);

	// X-ray: silhouettes glow (grazing to the eye), raised parts a little brighter
	float rim = pow(1.0 - abs(dot(n, v)), 3.0);
	float glow = 0.04 + rim * 0.85 + reliefAt(vUv) * 0.2;
	vec3 xray = uXrayColor * glow * uGhost;

	outColor = vec4(mix(xray, lit, uFocus), uFocus);
}
