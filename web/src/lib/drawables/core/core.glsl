// One relief stratum of the core, in the core's local space: x, z in [-0.5, 0.5] (the square), y up.
// The stratum is the plane y = uBase + dot(uSlope, xz) (a dipping layer), displaced upward by its image's
// relief map inside the image's rectangle, fading out through an irregular mineral margin (an imprint).
// Shared by layer.vert (displacement) and layer.frag (normals). Needs /noise.

uniform sampler2D uRelief; // R16F, 1 = closest to the viewer (doc/formats/relief.md), row 0 = image top
uniform vec4 uImageRect;   // the image inside the layer's uv square: xy = min corner, zw = size
uniform float uBase;       // plane height at the core axis
uniform vec2 uSlope;       // plane slope (dip) along x and z
uniform float uAmp;        // relief height, local units

// Relief (0..1) at a layer uv, masked by the imprint's irregular edge
float reliefAt(vec2 uv) {
	vec2 imageUv = (uv - uImageRect.xy) / uImageRect.zw;
	vec2 edge = min(imageUv, 1.0 - imageUv) * uImageRect.zw; // distance to the image edge, in layer uv
	float rough = (valueNoise(uv * 23.0) - 0.5) * 0.05;
	float mask = smoothstep(0.0, 0.05, min(edge.x, edge.y) + rough);
	return textureLod(uRelief, clamp(imageUv, 0.0, 1.0), 0.0).r * mask;
}

// Local position of the stratum at a layer uv (uv.x → x, uv.y → z; uv.y = 0 is the image top, far side)
vec3 layerPoint(vec2 uv) {
	vec2 xz = uv - 0.5;
	return vec3(xz.x, uBase + dot(uSlope, xz) + reliefAt(uv) * uAmp, xz.y);
}
