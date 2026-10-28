#version 300 es
precision highp float;
precision highp int;

// A relief stratum: a uv grid over the core's square, displaced by the image's relief map (./core).

#include /noise;
#include ./core;

layout(location = 0) in vec2 aUv; // explicit location: the VAO survives shader hot reload

uniform mat4 uModel;
uniform mat4 uViewProj;

out vec2 vUv;
out vec3 vLocal;

void main() {
	vUv = aUv;
	vLocal = layerPoint(aUv);
	gl_Position = uViewProj * uModel * vec4(vLocal, 1.0);
}
