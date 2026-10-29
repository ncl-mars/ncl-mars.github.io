import { setUniforms } from 'twgl.js';
import vertexSource from './sheet.vert';
import fragmentSource from './sheet.frag';
import { hotSwap, type Program } from '../../gl/programs';
import { LegendLines } from '../../legend/lines';
import type { SurveyCamera } from '../../gl/camera';
import type { Renderer } from '../../gl/renderer';
import type { DrawContext, Drawable } from '../../gl/types';
import type { Terrain } from '../terrain/Terrain';

let vertex = vertexSource;
let fragment = fragmentSource;

/** Read live every frame (tuning.legendShadows, the dev panel edits it). See schema.ts. */
export interface LegendShadowSettings {
	strength: number;
	thickness: number;
	maxLength: number;
}

/** The unit box, 12 triangles: x along the segment, y along the shadow (0..1), z across (±1). */
const BOX = (() => {
	const c = [
		[0, 0, -1], [1, 0, -1], [1, 1, -1], [0, 1, -1],
		[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
	];
	const faces = [
		[0, 1, 2, 0, 2, 3], [4, 6, 5, 4, 7, 6], [0, 4, 5, 0, 5, 1],
		[3, 2, 6, 3, 6, 7], [0, 3, 7, 0, 7, 4], [1, 5, 6, 1, 6, 2]
	];
	return new Float32Array(faces.flat().flatMap((i) => c[i]));
})();

/**
 * The legend lines' shadows in the god rays: each segment of a shown label (LegendLines, written by the
 * legend) casts a thin sheet of shadow through the air, away from the sun. Drawn after the terrain in the
 * same view, before the dust: boxes depth-tested against the ground, never writing depth, darkening what is
 * under them (sheet.frag works out how much). Takes the ground, the atmosphere and the shadow ceiling from
 * the terrain (`sceneUniforms`). The lines move with the labels, so this runs every frame, but only the
 * pixels the sheets cover pay, and nothing is drawn while no label is shown.
 */
export class LegendShadows implements Drawable {
	private program: Program | null = null;
	private vao: WebGLVertexArrayObject | null = null;
	private corners: WebGLBuffer | null = null;
	private instances: WebGLBuffer | null = null;
	private readonly sheet = new Float32Array(3);
	private readonly viewport = new Float32Array(4);
	private readonly uniforms: Record<string, unknown>;

	constructor(
		private readonly camera: SurveyCamera,
		private readonly terrain: Terrain,
		private readonly lines: LegendLines,
		private readonly settings: LegendShadowSettings
	) {
		this.uniforms = { uSheet: this.sheet, uViewport: this.viewport };
	}

	init(gl: WebGL2RenderingContext, renderer: Renderer) {
		this.program = renderer.program(vertex, fragment);
		this.vao = gl.createVertexArray();
		gl.bindVertexArray(this.vao);

		this.corners = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
		gl.bufferData(gl.ARRAY_BUFFER, BOX, gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

		// Per segment: start, end, line (pixel size, visibility); locations fixed in sheet.vert
		const stride = LegendLines.STRIDE * 4;
		this.instances = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
		gl.bufferData(gl.ARRAY_BUFFER, this.lines.data.byteLength, gl.DYNAMIC_DRAW);
		for (const [location, size, offset] of [
			[1, 3, 0],
			[2, 3, 12],
			[3, 2, 24]
		]) {
			gl.enableVertexAttribArray(location);
			gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
			gl.vertexAttribDivisor(location, 1);
		}
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
	}

	draw(gl: WebGL2RenderingContext, ctx: DrawContext) {
		const scene = this.terrain.sceneUniforms;
		const s = this.settings;
		const count = this.lines.count;
		if (!scene.uHeightmap || !scene.uShadow || count === 0 || s.strength <= 0) return;

		gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lines.data, 0, count * LegendLines.STRIDE);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);

		this.sheet[0] = s.strength;
		this.sheet[1] = Math.max(0.1, s.thickness);
		this.sheet[2] = Math.max(1, s.maxLength);
		const { rect } = ctx;
		this.viewport.set([rect.x, rect.y, rect.width, rect.height]);
		const u = this.uniforms;
		u.uViewProj = this.camera.viewProjection;

		const info = this.program!.info;
		gl.useProgram(info.program);
		gl.bindVertexArray(this.vao);
		setUniforms(info, scene);
		setUniforms(info, u);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LESS);
		gl.depthMask(false);
		gl.enable(gl.BLEND);
		// Darken the colour only: dst × (1 − alpha), the canvas alpha (the fade-in over the page) untouched
		gl.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
		gl.drawArraysInstanced(gl.TRIANGLES, 0, BOX.length / 3, count);
		gl.disable(gl.BLEND);
		gl.depthMask(true);
		gl.disable(gl.DEPTH_TEST);
		gl.bindVertexArray(null);
	}

	dispose(gl: WebGL2RenderingContext) {
		gl.deleteVertexArray(this.vao);
		gl.deleteBuffer(this.corners);
		gl.deleteBuffer(this.instances);
		this.vao = this.corners = this.instances = null;
	}
}

// Shader hot reload (also when an included chunk changes: noise, wind, fog)
if (import.meta.hot) {
	import.meta.hot.accept(['./sheet.vert', './sheet.frag'], ([v, f]) => {
		const next: [string, string] = [v?.default ?? vertex, f?.default ?? fragment];
		hotSwap([vertex, fragment], next);
		[vertex, fragment] = next;
	});
}
