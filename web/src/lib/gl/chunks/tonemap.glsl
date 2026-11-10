// The display transform, for every pass that writes colour to the screen: the scene is lit and fogged in
// linear light, then an exposure, a tone curve and the sRGB encode turn it into display values. Include with
// `#include /tonemap;`. The CPU mirrors it in gl/colour.ts (the page background matches the fog through it).

uniform vec2 uTone; // x: exposure (the whole picture), y: curve (0 neutral, 1 AgX, 2 ACES)

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

// AgX (Troy Sobotka's, the minimal fit by bwrensch): the highlights desaturate smoothly toward white, the hues
// hold. Linear in, linear out (its display curve undone), for the sRGB encode
vec3 toneAgx(vec3 c) {
	const mat3 inset = mat3(
		0.842479062253094, 0.0423282422610123, 0.0423756549057051,
		0.0784335999999992, 0.878468636469772, 0.0784336,
		0.0792237451477643, 0.0791661274605434, 0.879142973793104);
	const mat3 outset = mat3(
		1.19687900512017, -0.0528968517574562, -0.0529716355144438,
		-0.0980208811401368, 1.15190312990417, -0.0980434501171241,
		-0.0990297440797205, -0.0989611768448433, 1.15107367264116);
	const float minEv = -12.47393;
	const float maxEv = 4.026069;
	c = inset * c;
	c = (clamp(log2(max(c, vec3(1e-10))), minEv, maxEv) - minEv) / (maxEv - minEv);
	vec3 x2 = c * c;
	vec3 x4 = x2 * x2;
	c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4 - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232;
	return pow(max(outset * c, 0.0), vec3(2.2));
}

// ACES filmic, Narkowicz's fit: more contrast and saturation, the highlights desaturate toward white
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
	else if (uTone.y > 0.5) c = toneAgx(c);
	else c = toneNeutral(c);
	return linearToSrgb(c);
}
