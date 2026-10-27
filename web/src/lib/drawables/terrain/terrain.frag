#version 300 es
precision highp float;

#include /common;
#include /terrain;
#include ./surface;
#include ./march;
#include ./shade;

uniform mat4 uInvViewProj;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uFade; // 0 → 1 once the textures are loaded

in vec2 vUv;
out vec4 outColor;

void main() {
	// Camera ray through this pixel (the full-screen triangle covers exactly the view)
	vec4 farPoint = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
	vec3 rd = normalize(farPoint.xyz / farPoint.w - uCamPos);

	Surface s = marchSurface(uCamPos, rd);
	vec3 col = shadeSurface(s, rd);

	// Depth from the same matrices as the rasterized passes, so they composite against the ground
	if (s.hit) {
		vec4 clip = uViewProj * vec4(s.position, 1.0);
		gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
	} else {
		gl_FragDepth = 1.0;
	}

	outColor = vec4(col * uFade, uFade); // premultiplied: fades in over the page background
}
