import { setUniforms } from 'twgl.js';
import vertexSource from '../../gl/fullscreen.vert';
import fragmentSource from './terrain.frag';
import { hotSwap, type Program } from '../../gl/programs';
import { createHeightTexture, loadDataTexture } from '../../gl/textures';
import { loadHeightfield, type Heightfield } from '../../terrain/heightfield';
import type { TerrainAssets } from '../../terrain/assets';
import type { SurveyCamera } from '../../gl/camera';
import type { Renderer } from '../../gl/renderer';
import type { DrawContext, Drawable, Frame } from '../../gl/types';

let vertex = vertexSource;
let fragment = fragmentSource;

/** Read live every frame (the dev panel edits them). See schema.ts for what each value does. */
export interface TerrainSettings {
	march: { stepScale: number; precision: number; steps: number; refineSteps: number };
	shading: { tint: number[]; shadowLight: number; aoStrength: number; cavityStrength: number; exposure: number };
	fog: { color: number[]; density: number };
}

/**
 * The dig site's ground: a raymarched heightfield (surface stage: march.glsl) shaded from the baked maps
 * (shading stage: shade.glsl). It writes depth, so later passes (cords, particles, splats) composite against
 * it. It also drives the camera (`camera.update`). Draws nothing until the heightmap and maps are loaded,
 * then fades in. Textures are cached per GL context, so coming back to the page doesn't reload them.
 */
export class Terrain implements Drawable {
	/** CPU copy of the heightmap, once loaded (camera following, picking). */
	field: Heightfield | null = null;

	private program: Program | null = null;
	private vao: WebGLVertexArrayObject | null = null;
	private heightTexture: WebGLTexture | null = null;
	private mapsTexture: WebGLTexture | null = null;
	private fade = 0;
	private generation = 0;
	private readonly shadingVector = new Float32Array(4);
	private readonly uniforms: Record<string, unknown>;

	constructor(
		private readonly camera: SurveyCamera,
		private readonly assets: TerrainAssets,
		private readonly settings: TerrainSettings
	) {
		const { min, max } = assets.heightmap.bounds;
		const marginX = (max[0] - min[0]) * 0.1;
		const marginZ = (max[2] - min[2]) * 0.1;
		camera.setPanBounds(min[0] + marginX, min[2] + marginZ, max[0] - marginX, max[2] - marginZ);

		this.uniforms = {
			uBoundsMin: min,
			uBoundsMax: max,
			uSunDir: assets.maps.sunDir,
			uShading: this.shadingVector
		};
	}

	init(gl: WebGL2RenderingContext, renderer: Renderer) {
		this.program = renderer.program(vertex, fragment);
		this.vao = gl.createVertexArray();

		const generation = ++this.generation;
		const { heightmapUrl, heightmap, mapsUrl } = this.assets;
		const height = renderer.resource(`height:${heightmapUrl}`, (gl) =>
			loadHeightfield(heightmapUrl, heightmap).then((field) => ({
				field,
				texture: createHeightTexture(gl, heightmap.width, heightmap.height, field.half)
			}))
		);
		const maps = renderer.resource(`maps:${mapsUrl}`, (gl) => loadDataTexture(gl, mapsUrl));
		Promise.all([height, maps])
			.then(([h, mapsTexture]) => {
				if (generation !== this.generation) return; // disposed or re-initialised meanwhile
				this.field = h.field;
				this.heightTexture = h.texture;
				this.mapsTexture = mapsTexture;
			})
			.catch((error) => console.error('[terrain] loading failed:', error));
	}

	update(frame: Frame) {
		this.camera.update(frame.dt, this.field);
		if (this.heightTexture && this.mapsTexture) this.fade = Math.min(1, this.fade + frame.dt / 0.6);
	}

	draw(gl: WebGL2RenderingContext, { rect }: DrawContext) {
		if (!this.heightTexture || !this.mapsTexture || !this.field) return;
		const camera = this.camera;
		camera.setAspect(rect.width / rect.height);

		const { march, shading, fog } = this.settings;
		const s = this.shadingVector;
		s[0] = shading.shadowLight;
		s[1] = shading.aoStrength;
		s[2] = shading.cavityStrength;
		s[3] = shading.exposure;

		const u = this.uniforms;
		u.uInvViewProj = camera.inverseViewProjection;
		u.uViewProj = camera.viewProjection;
		u.uCamPos = camera.eye;
		u.uHeightmap = this.heightTexture;
		u.uMaps = this.mapsTexture;
		u.uSteps = march.steps;
		u.uRefineSteps = march.refineSteps;
		u.uStepScale = march.stepScale;
		u.uPrecision = march.precision;
		u.uTint = shading.tint;
		u.uFogColor = fog.color;
		u.uFogDensity = fog.density;
		u.uFade = this.fade;

		const info = this.program!.info;
		gl.useProgram(info.program);
		gl.bindVertexArray(this.vao);
		setUniforms(info, u);
		// Depth writes need the depth test on; ALWAYS because the raymarch decides the depth itself
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.ALWAYS);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.depthFunc(gl.LESS);
		gl.disable(gl.DEPTH_TEST);
		gl.bindVertexArray(null);
	}

	dispose(gl: WebGL2RenderingContext) {
		this.generation++; // ignore loads still in flight
		gl.deleteVertexArray(this.vao);
		this.vao = null;
		this.heightTexture = null; // textures stay in the renderer's per-context cache
		this.mapsTexture = null;
		this.fade = 0;
	}
}

// Shader hot reload (also when an included chunk changes: march, shade, terrain…)
if (import.meta.hot) {
	import.meta.hot.accept(['../../gl/fullscreen.vert', './terrain.frag'], ([v, f]) => {
		const next: [string, string] = [v?.default ?? vertex, f?.default ?? fragment];
		hotSwap([vertex, fragment], next);
		[vertex, fragment] = next;
	});
}
