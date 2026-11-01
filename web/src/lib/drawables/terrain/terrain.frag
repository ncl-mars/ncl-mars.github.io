#version 300 es
precision highp float;
precision highp int; // the noise hash needs 32-bit integers (fragment ints default to mediump)

// Renders the ground into the terrain cache (colour + depth), only when the camera or a terrain setting
// changes. No fog here: composite.frag adds the atmosphere every frame. The alpha holds the light shafts
// (./shafts): the share of the mist on the way that the sun reaches.

#include /common;
#include /noise;
#include /terrain;
#include ./surface;
#include ./march;
#include ./shafts;
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

	// On the sea, exactly on its plane: the march stops within a pixel's height of a surface, which on a flat
	// sea far away is metres above it (and further along a grazing ray); the composite recognises the water
	// by its height
	if (s.hit && rd.y < 0.0 && uCamPos.y > uSeaLevel) {
		float tSea = (uSeaLevel - uCamPos.y) / rd.y;
		vec3 onSea = uCamPos + rd * tSea;
		float slack = (s.t * uPrecision * 2.0 + 0.1) / max(-rd.y, 1e-4); // that height, along the ray
		if (tSea <= s.t + slack && terrainHeight(onSea.xz) < uSeaLevel) {
			s.t = tSea;
			s.position = onSea;
		}
	}

	// Depth from the same matrices as the rasterized passes; 1.0 (far plane) where the ray found nothing
	if (s.hit) {
		vec4 clip = uViewProj * vec4(s.position, 1.0);
		gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
	} else {
		gl_FragDepth = 1.0;
	}
	outColor = vec4(shadeSurface(s, rd), shaftLight(uCamPos, rd, s.hit ? s.t : uMaxDistance));
}
