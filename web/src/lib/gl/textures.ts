/** Texture helpers. Formats: doc/formats/. */

/**
 * Half-float data (heightmap, relief maps) as R16F. LINEAR filtering on R16F is core in WebGL2 (R32F would
 * need an extension). No mipmaps: shaders sample it with textureLod(…, 0). Row 0 = texture row 0, no flip.
 */
export function createHalfFloatTexture(
	gl: WebGL2RenderingContext,
	width: number,
	height: number,
	half: Uint16Array
): WebGLTexture {
	const texture = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2); // rows are width × 2 bytes, not always a multiple of 4
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, width, height, 0, gl.RED, gl.HALF_FLOAT, half);
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
