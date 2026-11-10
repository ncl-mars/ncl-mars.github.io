/**
 * Offscreen render targets: an RGBA8 or SRGB8_ALPHA8 colour texture + a DEPTH_COMPONENT24 depth texture (core WebGL2,
 * no float render targets) that a later pass can sample. Used by the terrain cache, later by transitions.
 * And a colour texture alone, for data rendered once (the terrain's shadow ceiling).
 */
export interface ColorDepthTarget {
	framebuffer: WebGLFramebuffer;
	color: WebGLTexture;
	depth: WebGLTexture;
	width: number;
	height: number;
}

/**
 * Colour is LINEAR-filtered (it may be upscaled); depth is NEAREST (depth textures can't be filtered).
 * `format`: RGBA8, or SRGB8_ALPHA8 for linear light (the GPU encodes on write and decodes on read, so 8 bits
 * keep the darks' precision; alpha stays linear).
 */
export function createColorDepthTarget(
	gl: WebGL2RenderingContext,
	width: number,
	height: number,
	format: number = gl.RGBA8
): ColorDepthTarget {
	const color = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, color);
	gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
	setSampling(gl, gl.LINEAR);

	const depth = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, depth);
	gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, width, height);
	setSampling(gl, gl.NEAREST);
	gl.bindTexture(gl.TEXTURE_2D, null);

	const framebuffer = gl.createFramebuffer()!;
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
	const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	if (status !== gl.FRAMEBUFFER_COMPLETE) {
		deleteColorDepthTarget(gl, { framebuffer, color, depth, width, height });
		throw new Error(`Render target incomplete (status 0x${status.toString(16)})`);
	}
	return { framebuffer, color, depth, width, height };
}

export function deleteColorDepthTarget(gl: WebGL2RenderingContext, target: ColorDepthTarget) {
	gl.deleteFramebuffer(target.framebuffer);
	gl.deleteTexture(target.color);
	gl.deleteTexture(target.depth);
}

/** A colour texture alone (no depth), rendered by a full-screen pass and sampled later (the shadow ceiling). */
export interface ColorTarget {
	framebuffer: WebGLFramebuffer;
	color: WebGLTexture;
	width: number;
	height: number;
}

/** `format`: a core colour-renderable format (RGBA8, R8…). LINEAR-filtered. */
export function createColorTarget(gl: WebGL2RenderingContext, width: number, height: number, format: number): ColorTarget {
	const color = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, color);
	gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
	setSampling(gl, gl.LINEAR);
	gl.bindTexture(gl.TEXTURE_2D, null);

	const framebuffer = gl.createFramebuffer()!;
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
	const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	if (status !== gl.FRAMEBUFFER_COMPLETE) {
		deleteColorTarget(gl, { framebuffer, color, width, height });
		throw new Error(`Render target incomplete (status 0x${status.toString(16)})`);
	}
	return { framebuffer, color, width, height };
}

export function deleteColorTarget(gl: WebGL2RenderingContext, target: ColorTarget) {
	gl.deleteFramebuffer(target.framebuffer);
	gl.deleteTexture(target.color);
}

function setSampling(gl: WebGL2RenderingContext, filter: number) {
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
