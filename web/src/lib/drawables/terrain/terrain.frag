#version 300 es
precision highp float;
precision highp int; // the noise hash needs 32-bit integers (fragment ints default to mediump)

// Renders the ground into the terrain cache (colour + depth), only when the camera or a terrain setting
// changes. No fog here: composite.frag adds the atmosphere every frame.

#include /common;
#include /noise;
#include /terrain;
#include ./surface;
#include ./march;
#include ./shade;

uniform mat4 uInvViewProj;
uniform mat4 uViewProj;
uniform vec3 uCamPos;

in vec2 vUv;
out vec4 outColor;

void main() {
	// Camera ray through this pixel (the full-screen triangle covers exactly the view)
	vec4 farPoint = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
	vec3 rd = normalize(farPoint.xyz / farPoint.w - uCamPos);

	Surface s = marchSurface(uCamPos, rd);

	// Depth from the same matrices as the rasterized passes; 1.0 (far plane) where the ray found nothing
	if (s.hit) {
		vec4 clip = uViewProj * vec4(s.position, 1.0);
		gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
	} else {
		gl_FragDepth = 1.0;
	}
	outColor = vec4(shadeSurface(s), 1.0);
}
