/**
 * Offscreen render targets: an RGBA8 colour texture + a DEPTH_COMPONENT24 depth texture (both core WebGL2,
 * no float render targets) that a later pass can sample. Used by the terrain cache, later by transitions.
 */
export interface ColorDepthTarget {
	framebuffer: WebGLFramebuffer;
	color: WebGLTexture;
	depth: WebGLTexture;
	width: number;
	height: number;
}

/** Colour is LINEAR-filtered (it may be upscaled); depth is NEAREST (depth textures can't be filtered). */
export function createColorDepthTarget(gl: WebGL2RenderingContext, width: number, height: number): ColorDepthTarget {
	const color = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, color);
	gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
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

function setSampling(gl: WebGL2RenderingContext, filter: number) {
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
