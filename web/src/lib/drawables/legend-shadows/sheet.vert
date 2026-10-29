#version 300 es
precision highp float;

// One legend segment's shadow, as a box of air (instanced: one per segment, from LegendLines): from the
// segment, along the sun away from it, until below the lowest ground; as thick as the line, in pixels at
// its depth. The fragment shader measures how much of each view ray crosses it.

uniform mat4 uViewProj;
uniform vec3 uSunDir;   // toward the sun (the bake's)
uniform vec2 uSlab;     // height range of the whole ground
uniform vec4 uSheet;    // x: strength, y: thickness (px of the line), z: longest path counted, w: ground shadow

layout(location = 0) in vec3 aCorner;   // unit box: x along the segment, y along the shadow (0..1), z across (±1)
layout(location = 1) in vec3 aStart;    // per segment (world)
layout(location = 2) in vec3 aEnd;
layout(location = 3) in vec2 aLine;     // x: size of a pixel at its depth (world units), y: visibility

out vec3 vWorld;
flat out vec3 vOrigin;
flat out mat3 vToBox;  // world offset from vOrigin → box coordinates (x, y in 0..1, z in ±1)
flat out float vVisibility;

void main() {
	vec3 along = aEnd - aStart;
	vec3 sun = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.05), uSunDir.z));
	float reach = (max(aStart.y, aEnd.y) - uSlab.x) / sun.y + 1.0;
	vec3 across = cross(along, sun);
	float len = length(across);
	across = len > 1e-6 ? across / len : vec3(1.0, 0.0, 0.0);
	mat3 frame = mat3(along, -sun * reach, across * (0.5 * uSheet.y * aLine.x));
	vec3 world = aStart + frame * aCorner;

	vWorld = world;
	vOrigin = aStart;
	vToBox = inverse(frame);
	vVisibility = aLine.y;
	gl_Position = uViewProj * vec4(world, 1.0);
}
