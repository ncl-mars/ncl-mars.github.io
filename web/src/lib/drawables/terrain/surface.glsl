// Contract between the two stages of the terrain: the surface stage (march.glsl, or a rasterized mesh as
// plan B) fills a Surface, the shading stage (shade.glsl) colours it.

struct Surface {
	bool hit;
	vec3 position; // world space
	float t;       // distance from the camera along the ray
};
