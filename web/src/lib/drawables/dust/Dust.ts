import { setUniforms } from 'twgl.js';
import vertexSource from './dust.vert';
import fragmentSource from './dust.frag';
import { hotSwap, type Program } from '../../gl/programs';
import { srgbToLinear } from '../../gl/colour';
import type { SurveyCamera } from '../../gl/camera';
import type { Renderer } from '../../gl/renderer';
import type { DrawContext, Drawable } from '../../gl/types';
import type { Terrain } from '../terrain/Terrain';

let vertex = vertexSource;
let fragment = fragmentSource;

/** Read live every frame (tuning.dust, the dev panel edits it). See schema.ts. */
export interface DustSettings {
	count: number;
	size: number;
	opacity: number;
	color: number[];
	backlight: number;
	range: number;
	height: number;
	follow: number;
	turbulence: number;
	turbulenceScale: number;
	turbulenceSpeed: number;
	hops: number;
	hopHeight: number;
	maxSize: number;
	nearFade: number;
}

/**
 * Dust in the wind, drawn after the terrain in the same view: points, depth-tested against the ground the
 * terrain wrote, blended over it (premultiplied), never writing depth. Everything happens in the vertex
 * shader (dust.vert): no buffers, the point's id is its seed. Takes the ground and the atmosphere from the
 * terrain (`sceneUniforms`, the display transform's `uTone` included), so it draws nothing until the ground
 * has loaded.
 */
export class Dust implements Drawable {
	private program: Program | null = null;
	private vao: WebGLVertexArrayObject | null = null;
	private maxPointSize = 64;
	private readonly centre = new Float32Array(2);
	private readonly box = new Float32Array(4);
	private readonly motion = new Float32Array(4);
	private readonly hop = new Float32Array(2);
	private readonly look = new Float32Array(4);
	private readonly colour = new Float32Array(3);
	private readonly uniforms: Record<string, unknown>;

	constructor(
		private readonly camera: SurveyCamera,
		private readonly terrain: Terrain,
		private readonly settings: DustSettings
	) {
		this.uniforms = { uCentre: this.centre, uBox: this.box, uMotion: this.motion, uHop: this.hop, uLook: this.look };
	}

	init(gl: WebGL2RenderingContext, renderer: Renderer) {
		this.program = renderer.program(vertex, fragment);
		this.vao = gl.createVertexArray(); // empty: the vertex shader works from gl_VertexID
		const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array;
		this.maxPointSize = range[1];
	}

	draw(gl: WebGL2RenderingContext, ctx: DrawContext) {
		const scene = this.terrain.sceneUniforms;
		const s = this.settings;
		const count = Math.floor(s.count);
		if (!scene.uHeightmap || count <= 0 || s.opacity <= 0) return;
		const camera = this.camera;

		// The box sits ahead of the camera, which stands near its back edge
		const eye = camera.eye;
		const target = camera.target;
		const dx = target[0] - eye[0];
		const dz = target[2] - eye[2];
		const length = Math.hypot(dx, dz) || 1;
		const ahead = s.range * 0.3;
		this.centre[0] = eye[0] + (dx / length) * ahead;
		this.centre[1] = eye[2] + (dz / length) * ahead;

		this.box.set([s.range, s.height, s.range * 0.08, s.nearFade]);
		this.motion.set([s.follow, s.turbulence, Math.max(1, s.turbulenceScale), s.turbulenceSpeed]);
		this.hop.set([s.hops, s.hopHeight]);
		const fade = (scene.uFade as number) ?? 1; // fades in with the terrain
		this.look.set([s.size, s.opacity * fade, s.backlight, Math.min(s.maxSize * ctx.pixelRatio, this.maxPointSize)]);
		const u = this.uniforms;
		u.uViewProj = camera.viewProjection;
		u.uCamPos = camera.eye;
		u.uDustColor = srgbToLinear(s.color, this.colour); // a display value, the shaders light in linear
		u.uFocal = ctx.rect.height * 0.5 * camera.projection[5]; // projection[5] = 1 / tan(fov / 2)

		const info = this.program!.info;
		gl.useProgram(info.program);
		gl.bindVertexArray(this.vao);
		setUniforms(info, scene);
		setUniforms(info, u);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LESS);
		gl.depthMask(false);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.drawArrays(gl.POINTS, 0, count);
		gl.disable(gl.BLEND);
		gl.depthMask(true);
		gl.disable(gl.DEPTH_TEST);
		gl.bindVertexArray(null);
	}

	dispose(gl: WebGL2RenderingContext) {
		gl.deleteVertexArray(this.vao);
		this.vao = null;
	}
}

// Shader hot reload (also when an included chunk changes: noise, terrain, wind, fog)
if (import.meta.hot) {
	import.meta.hot.accept(['./dust.vert', './dust.frag'], ([v, f]) => {
		const next: [string, string] = [v?.default ?? vertex, f?.default ?? fragment];
		hotSwap([vertex, fragment], next);
		[vertex, fragment] = next;
	});
}
