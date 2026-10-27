import { setUniforms } from 'twgl.js';
import vertexSource from '../../gl/fullscreen.vert';
import fragmentSource from './test.frag';
import { hotSwap, type Program } from '../../gl/programs';
import type { Renderer } from '../../gl/renderer';
import type { DrawContext, Drawable } from '../../gl/types';

// Current sources: hot reload replaces them, and new instances compile from the latest version
let vertex = vertexSource;
let fragment = fragmentSource;

/**
 * Debug drawable for the view system (used on /lab/views): animated bands, a 40 px grid, a 2 px border
 * on the element's edges and a top-left marker. If any of those look off, the view mapping is wrong.
 */
export class TestPattern implements Drawable {
	private program: Program | null = null;
	private vao: WebGLVertexArrayObject | null = null;
	private readonly uniforms = {
		uResolution: [0, 0],
		uPixelRatio: 1,
		uTime: 0,
		uTint: [0.3, 0.5, 0.7]
	};

	constructor(tint: [number, number, number]) {
		this.uniforms.uTint = tint;
	}

	init(gl: WebGL2RenderingContext, renderer: Renderer) {
		this.program = renderer.program(vertex, fragment);
		this.vao = gl.createVertexArray(); // empty: fullscreen.vert builds the triangle from gl_VertexID
	}

	draw(gl: WebGL2RenderingContext, { rect, frame, pixelRatio }: DrawContext) {
		const info = this.program!.info;
		const u = this.uniforms;
		u.uResolution[0] = rect.width;
		u.uResolution[1] = rect.height;
		u.uPixelRatio = pixelRatio;
		u.uTime = frame.time;
		gl.useProgram(info.program);
		gl.bindVertexArray(this.vao);
		setUniforms(info, u);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindVertexArray(null);
	}

	dispose(gl: WebGL2RenderingContext) {
		gl.deleteVertexArray(this.vao);
		this.vao = null;
	}
}

// Shader hot reload: recompile in place, keeping the GL context, the views and their state
if (import.meta.hot) {
	import.meta.hot.accept(['../../gl/fullscreen.vert', './test.frag'], ([v, f]) => {
		const next: [string, string] = [v?.default ?? vertex, f?.default ?? fragment];
		hotSwap([vertex, fragment], next);
		[vertex, fragment] = next;
	});
}
