#version 300 es
// Full-screen triangle built from gl_VertexID, no vertex buffer: gl.drawArrays(gl.TRIANGLES, 0, 3)
// with an empty VAO bound. The viewport maps it onto the view's rectangle; vUv covers it as 0..1.

out vec2 vUv;

void main() {
	vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
	vUv = p;
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
