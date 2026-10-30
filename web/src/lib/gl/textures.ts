/** Texture helpers. Formats: doc/formats/. */

/**
 * Heights as RG8: each 16-bit sample's two bytes as they lie in memory (little-endian: R the low byte, G the
 * high one, terrain/heightfield.ts), which the shaders put back together (terrain.glsl). Exact when fetched,
 * and filterable like any colour: filtering is linear, so the filtered bytes give the filtered height (to the
 * hardware's precision). No mipmaps: shaders sample it with textureLod(…, 0). Row 0 = texture row 0, no flip.
 */
export function createHeightTexture(
	gl: WebGL2RenderingContext,
	width: number,
	height: number,
	texels: Uint16Array
): WebGLTexture {
	const texture = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2); // rows of width × 2 bytes: not 4-aligned when the width is odd
	const bytes = new Uint8Array(texels.buffer, texels.byteOffset, texels.byteLength);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, width, height, 0, gl.RG, gl.UNSIGNED_BYTE, bytes);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
	setSampling(gl, gl.LINEAR, gl.LINEAR);
	gl.bindTexture(gl.TEXTURE_2D, null);
	return texture;
}

/**
 * Image holding data, not colour (terrain maps): decoded without colour-space conversion or premultiplied
 * alpha so the values reach the shader untouched, stored as RGBA8 (not sRGB), mipmapped.
 */
export async function loadDataTexture(gl: WebGL2RenderingContext, url: string): Promise<WebGLTexture> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	const bitmap = await createImageBitmap(await response.blob(), {
		colorSpaceConversion: 'none',
		premultiplyAlpha: 'none'
	});
	const texture = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // image row 0 = texture row 0 (= min z)
	gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
	gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
	gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
	bitmap.close();
	gl.generateMipmap(gl.TEXTURE_2D);
	setSampling(gl, gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
	gl.bindTexture(gl.TEXTURE_2D, null);
	return texture;
}

function setSampling(gl: WebGL2RenderingContext, min: number, mag: number) {
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
