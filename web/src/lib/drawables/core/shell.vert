#version 300 es
precision highp float;

// The core's translucent shell: a unit cube scaled to the core's square prism.

layout(location = 0) in vec3 aPosition; // unit cube, [-0.5, 0.5]³; explicit location for hot reload

uniform mat4 uModel;
uniform mat4 uViewProj;
uniform vec3 uShellSize;
uniform float uShellCenterY;

out vec3 vLocal;

void main() {
	vLocal = aPosition * uShellSize + vec3(0.0, uShellCenterY, 0.0);
	gl_Position = uViewProj * uModel * vec4(vLocal, 1.0);
}
