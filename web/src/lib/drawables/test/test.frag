#version 300 es
precision highp float;

#include /common;

uniform vec2 uResolution; // view size in device pixels
uniform float uPixelRatio;
uniform float uTime;
uniform vec3 uTint;

in vec2 vUv;
out vec4 outColor;

void main() {
	vec2 size = uResolution / uPixelRatio; // view size in CSS pixels
	vec2 px = vUv * size;

	// Moving bands: shows the loop is running
	vec3 col = uTint * (0.55 + 0.25 * sin(uTime * 1.5 - (px.x + px.y) * 0.02));

	// 40 CSS px grid: cells must stay square and crisp at any view size or pixel ratio
	vec2 g = abs(fract(px / 40.0 - 0.5) - 0.5) * 40.0;
	col = mix(col, vec3(1.0), (1.0 - smoothstep(0.5, 1.0, min(g.x, g.y))) * 0.25);

	// 2 px border: the exact edges of the DOM element
	vec2 edge = min(px, size - px);
	col = mix(col, vec3(1.0), 1.0 - step(2.0, min(edge.x, edge.y)));

	// Top-left marker: checks the Y flip (GL's origin is bottom-left)
	if (max(px.x, size.y - px.y) < 24.0) col = vec3(1.0, 0.85, 0.2);

	// Grain from the shared chunk: proves #include works
	col += (hash12(gl_FragCoord.xy) - 0.5) * 0.03;

	outColor = vec4(col, 1.0);
}
