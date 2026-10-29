#version 300 es
precision highp float;
precision highp int; // /noise's hash needs 32-bit integers

// A label's text, shading the ground (label.vert): where the ground seen at this pixel lies inside the
// label's shadow box, the sun ray from it crossed the text box at the box's x, y: the mask there says if a
// letter stood in the way. Blurs with the distance to the text (the penumbra), fades with the fog like the
// ground, and adds nothing where a ridge already shades it. Only the box face in front of the ground passes
// the depth test, so each pixel is shaded once.

#include /common;
#include /noise;
#include /wind;
#include /fog;

uniform highp sampler2D uDepth; // the terrain cache's depth
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec4 uViewport;         // the view's rectangle in device px (x, y, width, height)
uniform sampler2D uShadow;      // the terrain's shadow ceiling (drawables/terrain/shadow.frag), R8 over the slab
uniform vec4 uShadowBox;        // xy: its min corner (world xz), zw: 1 / size
uniform vec2 uSlab;
uniform sampler2D uMasks;       // the labels' text masks, one row each (R8, mipmapped)
uniform vec2 uRowScale[32];
uniform vec2 uAtlas;            // x: rows, y: width in texels
uniform vec2 uText;             // x: strength, y: softness (blur per world unit from the text)
uniform float uFade;            // the terrain's fade in

flat in vec3 vOrigin;
flat in mat3 vToBox;
flat in float vRow;
flat in float vVisibility;
flat in float vReach;
flat in float vTexel;

out vec4 outColor;

// Mirror of drawables/terrain/shafts.glsl's sunVisibility: 1 where the sun reaches p
float sunVisibility(vec3 p) {
	vec2 uv = (p.xz - uShadowBox.xy) * uShadowBox.zw;
	if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1.0;
	float ceiling = mix(uSlab.x, uSlab.y, textureLod(uShadow, uv, 0.0).r);
	return smoothstep(ceiling - 1.5, ceiling + 1.5, p.y);
}

void main() {
	vec2 uv = (gl_FragCoord.xy - uViewport.xy) / uViewport.zw;
	float depth = texture(uDepth, uv).r;
	if (depth >= 1.0) discard;
	vec4 p = uInvViewProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
	vec3 g = p.xyz / p.w;
	vec3 b = vToBox * (g - vOrigin);
	if (any(lessThan(b, vec3(0.0))) || any(greaterThan(b, vec3(1.0)))) discard;

	// The mask where the sun ray from here crossed the text box, blurred by the distance travelled
	int row = int(vRow + 0.5);
	vec2 extent = uRowScale[row];
	vec2 st = vec2(b.x * extent.x, (float(row) + b.y * extent.y) / uAtlas.x);
	float blur = b.z * vReach * uText.y;
	float mask = textureLod(uMasks, st, min(log2(max(1.0, blur / vTexel)), 3.0)).r;
	if (mask < 0.01) discard;

	vec3 toGround = g - uCamPos;
	float t = length(toGround);
	float fog = max(1.0 - exp(-t * uFogDensity), smoothstep(uFogEnd * 0.55, uFogEnd, t));
	float seen = (1.0 - fog) * exp(-mistDepth(uCamPos, toGround / t, t));
	float shade = uText.x * mask * sunVisibility(g + vec3(0.0, 1.5, 0.0)) * seen * vVisibility * uFade;
	if (shade < 0.002) discard;
	outColor = vec4(0.0, 0.0, 0.0, clamp(shade, 0.0, 1.0)); // blended as dst × (1 − alpha)
}
