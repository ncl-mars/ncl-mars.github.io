// The display transform, for every pass that writes colour to the screen: the scene is lit and fogged in
// linear light, then an exposure, a tone curve and the sRGB encode turn it into display values. Include with
// `#include /tonemap;`. The CPU mirrors it in gl/colour.ts (the page background matches the fog through it).

uniform vec2 uTone; // x: exposure (the whole picture), y: curve (0 none, clipped; 1 neutral; 2 ACES)

// Khronos PBR Neutral: hues and saturation kept up to near white, only the highlights roll off
vec3 toneNeutral(vec3 c) {
	const float start = 0.8 - 0.04;
	const float desaturation = 0.15;
	float x = min(c.r, min(c.g, c.b));
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	c -= offset;
	float peak = max(c.r, max(c.g, c.b));
	if (peak < start) return c;
	const float d = 1.0 - start;
	float newPeak = 1.0 - d * d / (peak + d - start);
	c *= newPeak / peak;
	float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
	return mix(c, vec3(newPeak), g);
}

// ACES filmic, Narkowicz's fit: more contrast, the highlights desaturate toward white
vec3 toneAces(vec3 c) {
	return clamp(c * (2.51 * c + 0.03) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
	c = clamp(c, 0.0, 1.0);
	return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// Scene-linear colour to display values
vec3 display(vec3 c) {
	c *= uTone.x;
	if (uTone.y > 1.5) c = toneAces(c);
	else if (uTone.y > 0.5) c = toneNeutral(c);
	return linearToSrgb(c);
}
