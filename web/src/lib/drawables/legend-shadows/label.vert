#version 300 es
precision highp float;

// One label's text shadow on the ground (instanced: one per shown label, from LegendLines.labels): its text
// box, pushed along the sun away from it until below the lowest ground. In the box's own coordinates, a
// point's x and y are where its sun ray crosses the text box: label.frag reads the mask there.

uniform mat4 uViewProj;
uniform vec3 uSunDir;          // toward the sun (the bake's)
uniform vec2 uSlab;            // height range of the whole ground
uniform vec2 uRowScale[32];    // each mask's extent in its atlas row (fractions of the atlas width, of a row)
uniform vec3 uAtlas;           // x: rows, y: width in texels, z: a row's height in texels

layout(location = 0) in vec3 aCorner;   // unit box 0..1: x across the text, y down it, z along the shadow
layout(location = 1) in vec3 aOrigin;   // per label: its text box's top-left corner (world)
layout(location = 2) in vec3 aAxisX;    // to the top-right corner
layout(location = 3) in vec3 aAxisY;    // to the bottom-left corner
layout(location = 4) in vec2 aLabel;    // x: its mask's row, y: visibility

out vec3 vWorld;
flat out vec3 vOrigin;
flat out mat3 vToBox;     // world offset from vOrigin → box coordinates (0..1)
flat out float vRow;
flat out float vVisibility;
flat out float vReach;    // the box's length along the sun (world units)
flat out float vTexel;    // a mask texel's size on the text box (world units)

void main() {
	vec3 sun = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.05), uSunDir.z));
	float highest = max(max(aOrigin.y, aOrigin.y + aAxisX.y), max(aOrigin.y + aAxisY.y, aOrigin.y + aAxisX.y + aAxisY.y));
	float reach = (highest - uSlab.x) / sun.y + 1.0;
	mat3 frame = mat3(aAxisX, aAxisY, -sun * reach);
	vOrigin = aOrigin;
	vRow = aLabel.x;
	vVisibility = aLabel.y;
	vReach = reach;
	int row = int(aLabel.x + 0.5);
	vTexel = length(aAxisX) / max(uRowScale[row].x * uAtlas.y, 1.0);
	// A text box edge-on to the sun casts no area: nothing to draw
	if (abs(determinant(frame)) < 1e-4 * length(aAxisX) * length(aAxisY) * reach) {
		vToBox = mat3(0.0);
		vWorld = aOrigin;
		gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // beyond the far plane: clipped
		return;
	}
	vToBox = inverse(frame);
	vWorld = aOrigin + frame * aCorner;
	gl_Position = uViewProj * vec4(vWorld, 1.0);
}
