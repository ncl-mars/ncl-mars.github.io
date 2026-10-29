#version 300 es
precision highp float;
precision highp int; // the noise hash needs 32-bit integers (fragment ints default to mediump)

// Every frame: the cached ground (colour + depth) under the live atmosphere (fog, height mist, wind-driven
// banks, sun glow). Rebuilds each pixel's world position from the cached depth, and writes that depth back
// so later passes (cords, particles, splats) composite against the ground.

#include /common;
#include /noise;
#include /wind;
#include /fog;

uniform sampler2D uColor;
uniform highp sampler2D uDepth; // highp: samplers default to lowp, which would ruin the depth
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform float uFade;            // 0 → 1 once the terrain is loaded

in vec2 vUv;
out vec4 outColor;

void main() {
	vec2 ndc = vUv * 2.0 - 1.0;
	vec4 farPoint = uInvViewProj * vec4(ndc, 1.0, 1.0);
	vec3 rd = normalize(farPoint.xyz / farPoint.w - uCamPos);

	float depth = texture(uDepth, vUv).r;
	vec3 col;
	if (depth < 1.0) {
		vec4 p = uInvViewProj * vec4(ndc, depth * 2.0 - 1.0, 1.0);
		float t = length(p.xyz / p.w - uCamPos);
		col = atmosphere(texture(uColor, vUv).rgb, uCamPos, rd, t);
	} else {
		col = skyColor(rd);
	}

	gl_FragDepth = depth;
	outColor = vec4(col * uFade, uFade); // premultiplied: fades in over the page background
}
