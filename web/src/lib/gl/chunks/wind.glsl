// The wind, shared by everything that moves with it (the mist now; cords and dust later), so a gust
// visibly travels through all of them together. Include with `#include /wind;`

uniform vec2 uWindDir;    // unit vector in xz: where the wind blows toward
uniform float uWindSpeed; // world units per second
uniform float uTime;      // seconds

// How far the air has travelled: scroll noise by this to make it drift with the wind
vec2 windScroll() {
	return uWindDir * uWindSpeed * uTime;
}
