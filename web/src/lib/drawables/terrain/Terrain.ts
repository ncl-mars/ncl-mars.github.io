import { setUniforms } from 'twgl.js';
import vertexSource from '../../gl/fullscreen.vert';
import marchSource from './terrain.frag';
import compositeSource from './composite.frag';
import { hotSwap, type Program } from '../../gl/programs';
import { createHalfFloatTexture, loadDataTexture } from '../../gl/textures';
import { createColorDepthTarget, deleteColorDepthTarget, type ColorDepthTarget } from '../../gl/targets';
import { loadHeightfield } from '../../terrain/heightfield';
import { Ground } from '../../terrain/ground';
import type { FarFieldSettings } from '../../terrain/farfield';
import type { TerrainAssets } from '../../terrain/assets';
import type { SurveyCamera } from '../../gl/camera';
import type { Renderer } from '../../gl/renderer';
import type { DrawContext, Drawable, Frame } from '../../gl/types';

let vertex = vertexSource;
let marchFragment = marchSource;
let compositeFragment = compositeSource;
/** Bumped by shader hot reload, so a still camera's cache gets re-marched with the new shader. */
let shaderGeneration = 0;

/** Read live every frame (the dev panel edits them). See schema.ts for what each value does. */
export interface TerrainSettings {
	march: { stepScale: number; precision: number; steps: number; refineSteps: number; renderScale: number };
	shading: { tint: number[]; shadowLight: number; aoStrength: number; cavityStrength: number; exposure: number };
	fog: {
		color: number[];
		skyColor: number[];
		density: number;
		end: number;
		sunColor: number[];
		sunGlow: number;
		sunPower: number;
	};
	mist: { density: number; height: number; falloff: number; banks: number; bankScale: number };
	wind: { direction: number; speed: number };
	farField: FarFieldSettings;
}

/**
 * The dig site's ground and its atmosphere, in two passes:
 * 1. March (terrain.frag): the heightmap blended into the endless far field, raymarched and shaded into a
 *    cache (colour + depth), only when the camera moves (`camera.revision`), the view resizes or a terrain
 *    setting changes (`invalidate()`). Its resolution is `march.renderScale`.
 * 2. Composite (composite.frag), every frame: the cache under the live atmosphere (fog, height mist,
 *    wind-driven banks, sun glow), with the cached depth written back for later passes.
 * Also drives the camera (`camera.update`) with the CPU `Ground`. Draws nothing until the heightmap and
 * maps are loaded, then fades in. Textures are cached per GL context; the cache target is per instance.
 */
export class Terrain implements Drawable {
	/** The whole ground on the CPU (heightmap + far field), once loaded: camera following, picking. */
	ground: Ground | null = null;
	/** Dev readout: re-marches since init, and whether the last frame re-marched. */
	marches = 0;
	marchedLastFrame = false;
	/**
	 * For passes drawn after it in the scene (dust): the uniforms of /terrain, /wind and /fog, so they stand
	 * on the same ground and sit in the same atmosphere. Refreshed by every draw; empty until the ground has
	 * loaded (check `uHeightmap`).
	 */
	readonly sceneUniforms: Record<string, unknown> = {};

	private marchProgram: Program | null = null;
	private compositeProgram: Program | null = null;
	private vao: WebGLVertexArrayObject | null = null;
	private heightTexture: WebGLTexture | null = null;
	private mapsTexture: WebGLTexture | null = null;
	private cache: ColorDepthTarget | null = null;
	private cachedRevision = -1;
	private cachedShaders = -1;
	private dirty = true;
	private fade = 0;
	private time = 0;
	private generation = 0;

	private readonly shadingVector = new Float32Array(4);
	private readonly farFieldVector = new Float32Array(4);
	private readonly slabVector = new Float32Array(2);
	private readonly sunGlowVector = new Float32Array(2);
	private readonly mistVector = new Float32Array(4);
	private readonly windVector = new Float32Array(2);
	private readonly marchUniforms: Record<string, unknown>;
	private readonly compositeUniforms: Record<string, unknown>;

	constructor(
		private readonly camera: SurveyCamera,
		private readonly assets: TerrainAssets,
		private readonly settings: TerrainSettings
	) {
		// Panning stays over the heightmap (where the projects are); the far field is scenery
		const { min, max } = assets.heightmap.bounds;
		const marginX = (max[0] - min[0]) * 0.1;
		const marginZ = (max[2] - min[2]) * 0.1;
		camera.setPanBounds(min[0] + marginX, min[2] + marginZ, max[0] - marginX, max[2] - marginZ);

		this.marchUniforms = {
			uBoundsMin: min,
			uBoundsMax: max,
			uSunDir: assets.maps.sunDir,
			uShading: this.shadingVector,
			uFarField: this.farFieldVector,
			uSlab: this.slabVector
		};
		this.compositeUniforms = {
			uSunDir: assets.maps.sunDir,
			uSunGlow: this.sunGlowVector,
			uMist: this.mistVector,
			uWindDir: this.windVector
		};
	}

	/** A setting that changes the ground itself (not the atmosphere) was edited: re-march next frame. */
	invalidate() {
		this.dirty = true;
	}

	init(gl: WebGL2RenderingContext, renderer: Renderer) {
		this.marchProgram = renderer.program(vertex, marchFragment);
		this.compositeProgram = renderer.program(vertex, compositeFragment);
		this.vao = gl.createVertexArray();
		this.dirty = true;

		const generation = ++this.generation;
		const { heightmapUrl, heightmap, mapsUrl } = this.assets;
		const height = renderer.resource(`height:${heightmapUrl}`, (gl) =>
			loadHeightfield(heightmapUrl, heightmap).then((field) => ({
				field,
				texture: createHalfFloatTexture(gl, heightmap.width, heightmap.height, field.half)
			}))
		);
		const maps = renderer.resource(`maps:${mapsUrl}`, (gl) => loadDataTexture(gl, mapsUrl));
		Promise.all([height, maps])
			.then(([h, mapsTexture]) => {
				if (generation !== this.generation) return; // disposed or re-initialised meanwhile
				this.ground = new Ground(h.field, this.settings.farField, this.settings.fog);
				this.heightTexture = h.texture;
				this.mapsTexture = mapsTexture;
				this.dirty = true;
			})
			.catch((error) => console.error('[terrain] loading failed:', error));
	}

	update(frame: Frame) {
		this.time = frame.time;
		this.camera.update(frame.dt, this.ground);
		if (this.heightTexture && this.mapsTexture) this.fade = Math.min(1, this.fade + frame.dt / 0.6);
	}

	draw(gl: WebGL2RenderingContext, ctx: DrawContext) {
		const ground = this.ground;
		if (!this.heightTexture || !this.mapsTexture || !ground) return;
		this.camera.setAspect(ctx.rect.width / ctx.rect.height);

		const scale = Math.min(1, Math.max(0.25, this.settings.march.renderScale));
		const width = Math.max(1, Math.round(ctx.rect.width * scale));
		const height = Math.max(1, Math.round(ctx.rect.height * scale));
		if (!this.cache || this.cache.width !== width || this.cache.height !== height) {
			if (this.cache) deleteColorDepthTarget(gl, this.cache);
			this.cache = createColorDepthTarget(gl, width, height);
			this.dirty = true;
		}

		this.marchedLastFrame =
			this.dirty || this.camera.revision !== this.cachedRevision || shaderGeneration !== this.cachedShaders;
		if (this.marchedLastFrame) this.march(gl, ctx, ground, this.cache);
		this.composite(gl, ctx, ground, this.cache);
	}

	dispose(gl: WebGL2RenderingContext) {
		this.generation++; // ignore loads still in flight
		gl.deleteVertexArray(this.vao);
		this.vao = null;
		if (this.cache) deleteColorDepthTarget(gl, this.cache);
		this.cache = null;
		this.heightTexture = null; // textures stay in the renderer's per-context cache
		this.mapsTexture = null;
		this.fade = 0;
	}

	/** Raymarch the ground into the cache, then restore the renderer's target, viewport and scissor. */
	private march(gl: WebGL2RenderingContext, ctx: DrawContext, ground: Ground, cache: ColorDepthTarget) {
		const camera = this.camera;
		const { march, shading, fog, farField } = this.settings;
		const s = this.shadingVector;
		s[0] = shading.shadowLight;
		s[1] = shading.aoStrength;
		s[2] = shading.cavityStrength;
		s[3] = shading.exposure;
		const f = this.farFieldVector;
		f[0] = ground.farBase;
		f[1] = farField.amplitude;
		f[2] = farField.scale;
		f[3] = ground.band;
		const [slabMin, slabMax] = ground.slab;
		this.slabVector[0] = slabMin;
		this.slabVector[1] = slabMax;

		const u = this.marchUniforms;
		u.uInvViewProj = camera.inverseViewProjection;
		u.uViewProj = camera.viewProjection;
		u.uCamPos = camera.eye;
		u.uHeightmap = this.heightTexture;
		u.uMaps = this.mapsTexture;
		u.uSteps = march.steps;
		u.uRefineSteps = march.refineSteps;
		u.uStepScale = march.stepScale;
		u.uPrecision = march.precision;
		u.uMaxDistance = fog.end;
		u.uTint = shading.tint;

		gl.bindFramebuffer(gl.FRAMEBUFFER, cache.framebuffer);
		gl.viewport(0, 0, cache.width, cache.height);
		gl.disable(gl.SCISSOR_TEST);
		this.drawFullscreen(gl, this.marchProgram!, u);

		const { rect, scissor } = ctx;
		gl.bindFramebuffer(gl.FRAMEBUFFER, ctx.target);
		gl.viewport(rect.x, rect.y, rect.width, rect.height);
		gl.enable(gl.SCISSOR_TEST);
		gl.scissor(scissor.x, scissor.y, scissor.width, scissor.height);

		this.cachedRevision = camera.revision;
		this.cachedShaders = shaderGeneration;
		this.dirty = false;
		this.marches++;
	}

	/** The cached ground under the live atmosphere, into the view. */
	private composite(gl: WebGL2RenderingContext, ctx: DrawContext, ground: Ground, cache: ColorDepthTarget) {
		const camera = this.camera;
		const { fog, mist, wind } = this.settings;
		this.sunGlowVector[0] = fog.sunGlow;
		this.sunGlowVector[1] = fog.sunPower;
		const m = this.mistVector;
		m[0] = mist.density;
		m[1] = ground.slab[0] + mist.height; // base height above the lowest ground
		m[2] = Math.max(0.1, mist.falloff);
		m[3] = mist.banks;
		const direction = (wind.direction * Math.PI) / 180; // compass, blowing toward: 0 = north (−Z)
		this.windVector[0] = Math.sin(direction);
		this.windVector[1] = -Math.cos(direction);

		const u = this.compositeUniforms;
		u.uColor = cache.color;
		u.uDepth = cache.depth;
		u.uInvViewProj = camera.inverseViewProjection;
		u.uCamPos = camera.eye;
		u.uFade = this.fade;
		u.uFogColor = fog.color;
		u.uSkyColor = fog.skyColor;
		u.uFogDensity = fog.density;
		u.uFogEnd = fog.end;
		u.uSunColor = fog.sunColor;
		u.uBankScale = mist.bankScale;
		u.uWindSpeed = wind.speed;
		u.uTime = this.time;
		this.drawFullscreen(gl, this.compositeProgram!, u);

		const scene = this.sceneUniforms;
		Object.assign(scene, u);
		scene.uHeightmap = this.heightTexture;
		scene.uBoundsMin = this.marchUniforms.uBoundsMin;
		scene.uBoundsMax = this.marchUniforms.uBoundsMax;
		scene.uFarField = this.farFieldVector;
	}

	/** Full-screen triangle with depth writes (ALWAYS: the shader decides the depth itself). */
	private drawFullscreen(gl: WebGL2RenderingContext, program: Program, uniforms: Record<string, unknown>) {
		gl.useProgram(program.info.program);
		gl.bindVertexArray(this.vao);
		setUniforms(program.info, uniforms);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.ALWAYS);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.depthFunc(gl.LESS);
		gl.disable(gl.DEPTH_TEST);
		gl.bindVertexArray(null);
	}
}

// Shader hot reload (also when an included chunk changes: march, shade, terrain, fog, wind…)
if (import.meta.hot) {
	import.meta.hot.accept(['../../gl/fullscreen.vert', './terrain.frag', './composite.frag'], ([v, m, c]) => {
		const nextVertex = v?.default ?? vertex;
		const nextMarch = m?.default ?? marchFragment;
		const nextComposite = c?.default ?? compositeFragment;
		hotSwap([vertex, marchFragment], [nextVertex, nextMarch]);
		hotSwap([vertex, compositeFragment], [nextVertex, nextComposite]);
		[vertex, marchFragment, compositeFragment] = [nextVertex, nextMarch, nextComposite];
		shaderGeneration++;
	});
}
