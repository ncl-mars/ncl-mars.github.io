#version 300 es
precision mediump float;

// A dust speck: a soft round point, premultiplied (the vertex shader did the colour, fog and fades).

in vec4 vColor;
out vec4 outColor;

void main() {
	vec2 q = gl_PointCoord * 2.0 - 1.0;
	float d = dot(q, q);
	if (d >= 1.0) discard;
	float soft = (1.0 - d) * (1.0 - d);
	outColor = vColor * soft;
}
