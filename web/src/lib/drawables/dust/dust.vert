#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D; // the heightmap: vertex samplers default to lowp
precision highp sampler3D; // no default precision

// Dust: airborne specks carried by the wind, low over the ground and thinning with height, glowing when the
// sun is behind them, in the same mist as the terrain. Stateless: a speck's position is a function of its
// id and the time (no simulation buffers). They live in a box ahead of the camera, anchored in the world
// and wrapping at its edges (where they fade out), so the density is the same everywhere.

#include /common;
#include /noise;
#include /terrain;
#include /wind;
#include /fog;

uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform vec2 uCentre;     // box centre (x, z)
uniform vec4 uBox;        // x: box size (x and z), y: height range above the ground, z: edge fade band, w: near fade distance
uniform vec4 uMotion;     // x: wind follow, y: turbulence (world units), z: turbulence scale (world units), w: turbulence speed
uniform vec2 uHop;        // x: share of specks hopping along the ground, y: hop height
uniform vec4 uLook;       // x: size (world units), y: opacity, z: backlight, w: largest point (px)
uniform vec3 uDustColor;
uniform float uFocal;     // px per world unit at unit depth: viewport height / (2 tan(fov / 2))
// uNoise (the 3D noise texture) is declared by /fog

out vec4 vColor;          // premultiplied

float rand(int id, int k) {
	return latticeHash(ivec2(id, k));
}

void main() {
	int id = gl_VertexID;
	float size = uBox.x;

	// Turbulence in the frame of the air (eddies travel with the wind): each speck wanders around its place
	vec2 home = vec2(rand(id, 0), rand(id, 1)) * size;
	vec3 swirl = textureLod(uNoise, vec3(home / uMotion.z, uTime * uMotion.w + rand(id, 2) * 2.0) / 8.0, 0.0).xyz;
	swirl = (swirl - 0.5) * 2.0 * uMotion.y;

	// Carried by the wind (each speck a little faster or slower), wrapped into the box
	vec2 air = home + uWindDir * uWindSpeed * uTime * uMotion.x * mix(0.8, 1.2, rand(id, 3)) + swirl.xz;
	vec2 corner = uCentre - size * 0.5;
	vec2 xz = corner + mod(air - corner, size);

	// Height above the ground: most specks low (squared distribution); some skip along it in small hops
	float h;
	if (rand(id, 4) < uHop.x) {
		float f = fract(uTime * mix(0.7, 1.5, rand(id, 5)) + rand(id, 6));
		h = uHop.y * mix(0.4, 1.0, rand(id, 7)) * 4.0 * f * (1.0 - f);
	} else {
		float r = rand(id, 8);
		h = uBox.y * r * r + swirl.y * 0.5;
	}
	vec3 p = vec3(xz.x, height(xz) + max(h, 0.05), xz.y);
	vec4 clip = uViewProj * vec4(p, 1.0);

	// Fades: near the box's edges (where specks wrap), and right in front of the lens
	vec2 edges = min(xz - corner, corner + size - xz);
	float alpha = uLook.y * smoothstep(0.0, uBox.z, min(edges.x, edges.y));
	vec3 toSpeck = p - uCamPos;
	float t = length(toSpeck);
	alpha *= smoothstep(uBox.w, uBox.w * 2.0, t);

	// Size in pixels from the world size; under 1.5 px, keep 1.5 px and fade by the area instead (no flicker)
	float px = uLook.x * uFocal / max(clip.w, 1e-3);
	if (px < 1.5) {
		alpha *= (px / 1.5) * (px / 1.5);
		px = 1.5;
	}
	if (alpha < 0.002 || clip.w <= 0.0) {
		// Invisible: off-screen, nothing rasterised
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		gl_PointSize = 1.0;
		vColor = vec4(0.0);
		return;
	}
	gl_Position = clip;
	gl_PointSize = min(px, uLook.w);

	// Lit from behind: specks glow when the camera looks toward the sun through them; then the mist
	vec3 rd = toSpeck / max(t, 1e-3);
	float glow = pow(max(dot(rd, uSunDir), 0.0), 6.0) * uLook.z;
	vec3 col = atmosphere(uDustColor + uSunColor * glow, uCamPos, rd, t);
	vColor = vec4(col * alpha, alpha);
}
