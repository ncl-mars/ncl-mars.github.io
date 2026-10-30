import { setUniforms } from 'twgl.js';
import vertexSource from '../../gl/fullscreen.vert';
import marchSource from './terrain.frag';
import compositeSource from './composite.frag';
import shadowSource from './shadow.frag';
import { hotSwap, type Program } from '../../gl/programs';
import { createHalfFloatTexture, loadDataTexture } from '../../gl/textures';
import { createNoiseTexture3D } from '../../gl/noise';
import {
	createColorDepthTarget,
	createColorTarget,
	deleteColorDepthTarget,
	deleteColorTarget,
	type ColorDepthTarget,
	type ColorTarget
} from '../../gl/targets';
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
let shadowFragment = shadowSource;
/** Bumped by shader hot reload, so a still camera's cache gets re-marched with the new shader. */
let shaderGeneration = 0;
/** Seconds the camera must stay still before the sharp march replaces the rough one. */
const SETTLE_TIME = 0.15;
/** Browser storage key: this device's moving frames ran slow (automatic rough march in motion), remembered. */
const SLOW_MOTION_KEY = 'terrain-slow-motion';
/**
 * Shadow ceiling (light shafts, shadows on the terrain past the baked maps): texels per side, and the square
 * it covers, in heightmap sizes, centred on it. Kept to the heightmap's surroundings even with a far map, so
 * the detail stays where the POIs are; terrain further out has no cast shadows.
 */
const SHADOW_SIZE = 512;
const SHADOW_EXTENT = 2;

/** Read live every frame (the dev panel edits them). See schema.ts for what each value does. */
export interface TerrainSettings {
	march: {
		stepScale: number;
		precision: number;
		steps: number;
		refineSteps: number;
		renderScale: number;
		motionScale: number;
		motionMode: number;
	};
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
	shafts: { samples: number; softness: number; darkness: number; glow: number; power: number; view: number };
	zones: {
		zone1: number[];
		zone2: number[];
		zone3: number[];
		edge: number;
		rock: number[];
		rockAmount: number;
		rockSlope: number;
		rockSoftness: number;
		detail: number;
		detailSize: number;
	};
	water: {
		level: number;
		shallow: number[];
		deep: number[];
		depth: number;
		foam: number;
		foamWidth: number;
		waveSize: number;
		waveSpeed: number;
		waves: number;
		waveFade: number;
		reflection: number;
		glint: number;
		glintSize: number;
	};
	wind: { direction: number; speed: number };
	farField: FarFieldSettings;
}

/**
 * The dig site's ground and its atmosphere, in two passes:
 * 1. March (terrain.frag): the heightmap blended into the endless far field, raymarched and shaded into a
 *    cache (colour + depth), only when the camera moves (`camera.revision`), the view resizes or a terrain
 *    setting changes (`invalidate()`). Its resolution is `march.renderScale`. On a device whose moving
 *    frames run slow (`march.motionMode`: automatic, see `degrade`), or always, it marches a rough cache
 *    while the camera moves (× `march.motionScale`, the march being the costly part of a moving frame),
 *    and once the camera has been still a moment, the sharp one. The cache's alpha holds the light
 *    shafts: the share of the air on each ray (mist and haze) that the sun reaches, through the shadow
 *    ceiling (shadow.frag, rendered once per ground: the sun and the ground are fixed).
 * 2. Composite (composite.frag), every frame: the cache under the live atmosphere (fog, height mist,
 *    wind-driven banks, sun glow, light shafts), with the cached depth written back for later passes.
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
	 * For passes drawn after it in the scene (dust, legend shadows): the uniforms of /terrain, /wind and /fog,
	 * so they stand on the same ground and sit in the same atmosphere; the cache's depth (`uDepth`); and the
	 * shadow ceiling (`uShadow`, `uShadowBox`, `uSlab`). Refreshed by every draw; empty until the ground has
	 * loaded (check `uHeightmap`).
	 */
	readonly sceneUniforms: Record<string, unknown> = {};

	private marchProgram: Program | null = null;
	private compositeProgram: Program | null = null;
	private shadowProgram: Program | null = null;
	private vao: WebGLVertexArrayObject | null = null;
	private heightTexture: WebGLTexture | null = null;
	/** The far map's heights, or null without one (the heightmap's then stands in, unused). */
	private farTexture: WebGLTexture | null = null;
	private mapsTexture: WebGLTexture | null = null;
	/** The zones' masks, or a 1×1 black stand-in without a zones file. */
	private zonesTexture: WebGLTexture | null = null;
	/** For the mist banks (/fog). */
	private noiseTexture: WebGLTexture | null = null;
	/** The terrain cache at `renderScale`, and at `renderScale × motionScale` for a moving camera. */
	private sharp: ColorDepthTarget | null = null;
	private rough: ColorDepthTarget | null = null;
	/** The cache the composite reads: the last one marched. */
	private shown: ColorDepthTarget | null = null;
	/** `march.motionMode` as last seen (changing it restarts the automatic detection). */
	private motionMode = -1;
	/** Automatic mode: moving frames ran slow on this device (remembered), so the rough cache is marched in motion. */
	private slowMotion = false;
	/** Share of the recent frames (~0.5 s) in which the camera moved. */
	private motionShare = 0;
	/** The shadow ceiling (R8 over the slab), and the ground it was rendered for (far field, shaders). */
	private shadow: ColorTarget | null = null;
	private shadowKey = '';
	private stillTime = 0;
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
	private readonly shadowBox = new Float32Array(4);
	private readonly farBounds = new Float32Array(4);
	private readonly farRange = new Float32Array(3);
	private readonly walkVector = new Float32Array(2);
	private readonly shaftMarchVector = new Float32Array(4);
	private readonly shaftsVector = new Float32Array(3);
	private readonly waterVector = new Float32Array(3);
	private readonly rockVector = new Float32Array(4);
	private readonly rockSlopeVector = new Float32Array(2);
	private readonly detailVector = new Float32Array(2);
	private readonly wavesVector = new Float32Array(4);
	private readonly seaVector = new Float32Array(3);
	private readonly marchUniforms: Record<string, unknown>;
	private readonly compositeUniforms: Record<string, unknown>;
	private readonly shadowUniforms: Record<string, unknown>;

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

		// The far map's box (its heights come once loaded; its band from the settings, per march)
		const far = assets.farMap?.bounds;
		if (far) {
			this.farBounds.set([far.min[0], far.min[2], far.max[0], far.max[2]]);
			this.farRange.set([far.min[1], far.max[1], 0]);
		}

		// The shadow ceiling covers twice the heightmap around it (lit beyond, faded)
		const size = SHADOW_EXTENT * Math.max(max[0] - min[0], max[2] - min[2]);
		this.shadowBox.set([(min[0] + max[0] - size) / 2, (min[2] + max[2] - size) / 2, 1 / size, 1 / size]);

		this.marchUniforms = {
			uBoundsMin: min,
			uBoundsMax: max,
			uSunDir: assets.maps.sunDir,
			uShading: this.shadingVector,
			uFarField: this.farFieldVector,
			uFarBounds: this.farBounds,
			uFarRange: this.farRange,
			uSlab: this.slabVector,
			uShadowBox: this.shadowBox,
			uShaftMarch: this.shaftMarchVector,
			uMist: this.mistVector,
			uWater: this.waterVector,
			uRock: this.rockVector,
			uRockSlope: this.rockSlopeVector,
			uDetail: this.detailVector
		};
		this.compositeUniforms = {
			uSunDir: assets.maps.sunDir,
			uSunGlow: this.sunGlowVector,
			uMist: this.mistVector,
			uShafts: this.shaftsVector,
			uWindDir: this.windVector,
			uWaves: this.wavesVector,
			uSea: this.seaVector,
			uShadowBox: this.shadowBox,
			uSlab: this.slabVector
		};
		this.shadowUniforms = {
			uBoundsMin: min,
			uBoundsMax: max,
			uSunDir: assets.maps.sunDir,
			uFarField: this.farFieldVector,
			uFarBounds: this.farBounds,
			uFarRange: this.farRange,
			uSlab: this.slabVector,
			uShadowBox: this.shadowBox,
			uWalk: this.walkVector
		};
	}

	/** A setting the march caches (the ground, the light shafts) was edited: re-march next frame. */
	invalidate() {
		this.dirty = true;
	}

	init(gl: WebGL2RenderingContext, renderer: Renderer) {
		this.marchProgram = renderer.program(vertex, marchFragment);
		this.compositeProgram = renderer.program(vertex, compositeFragment);
		this.shadowProgram = renderer.program(vertex, shadowFragment);
		this.vao = gl.createVertexArray();
		this.noiseTexture = renderer.resource('noise:3d', (gl) => createNoiseTexture3D(gl));
		this.shadow = createColorTarget(gl, SHADOW_SIZE, SHADOW_SIZE, gl.R8);
		this.shadowKey = '';
		this.dirty = true;
		try {
			this.slowMotion ||= localStorage.getItem(SLOW_MOTION_KEY) === '1';
		} catch {
			// storage unavailable (private mode): detected again on each visit
		}

		const generation = ++this.generation;
		const { heightmapUrl, heightmap, farMapUrl, farMap, mapsUrl, zonesUrl } = this.assets;
		const heights = (url: string, meta: typeof heightmap) =>
			renderer.resource(`height:${url}`, (gl) =>
				loadHeightfield(url, meta).then((field) => ({
					field,
					texture: createHalfFloatTexture(gl, meta.width, meta.height, field.half)
				}))
			);
		const height = heights(heightmapUrl, heightmap);
		const far = farMapUrl && farMap ? heights(farMapUrl, farMap) : Promise.resolve(null);
		const maps = renderer.resource(`maps:${mapsUrl}`, (gl) => loadDataTexture(gl, mapsUrl));
		const zones = zonesUrl
			? renderer.resource(`maps:${zonesUrl}`, (gl) => loadDataTexture(gl, zonesUrl))
			: Promise.resolve(renderer.resource('zones:none', (gl) => blackTexture(gl)));
		Promise.all([height, far, maps, zones])
			.then(([h, f, mapsTexture, zonesTexture]) => {
				if (generation !== this.generation) return; // disposed or re-initialised meanwhile
				this.ground = new Ground(h.field, f?.field ?? null, this.settings.farField, this.settings.water, this.settings.fog);
				this.heightTexture = h.texture;
				this.farTexture = f?.texture ?? null;
				this.mapsTexture = mapsTexture;
				this.zonesTexture = zonesTexture;
				this.shadowKey = '';
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

		// Mist: the composite's, and the march weighs the light shafts with it
		const { mist } = this.settings;
		const m = this.mistVector;
		m[0] = mist.density;
		m[1] = ground.slab[0] + mist.height; // base height above the lowest ground
		m[2] = Math.max(0.1, mist.falloff);
		m[3] = mist.banks;

		const march = this.settings.march;
		const mode = Math.round(march.motionMode);
		if (mode !== this.motionMode) {
			// Changed in the panel (not the first draw): forget the detection, it starts again
			if (this.motionMode !== -1) this.rememberSlowMotion(false);
			this.motionMode = mode;
		}
		const scale = Math.min(1, Math.max(0.25, march.renderScale));
		const motion = Math.min(1, Math.max(0.1, march.motionScale));
		this.sharp = this.fit(gl, this.sharp, ctx, scale);
		this.rough =
			this.roughInMotion && motion < 1 ? this.fit(gl, this.rough, ctx, scale * motion) : this.release(gl, this.rough);

		// Moving: march the rough cache if there is one. Still: the sharp one, once the camera has settled (a
		// slow drag has frames without movement, which shouldn't each pay for a sharp march), or when a setting
		// changed.
		const moved = this.camera.revision !== this.cachedRevision;
		this.stillTime = moved ? 0 : this.stillTime + ctx.frame.dt;
		this.motionShare += (Number(moved) - this.motionShare) * Math.min(1, ctx.frame.dt / 0.5);
		let target: ColorDepthTarget | null = null;
		if (moved) target = this.rough ?? this.sharp;
		else if (this.dirty || shaderGeneration !== this.cachedShaders || !this.shown) target = this.sharp;
		else if (this.shown !== this.sharp && this.stillTime >= SETTLE_TIME) target = this.sharp;
		this.marchedLastFrame = target !== null;
		if (target) {
			this.march(gl, ctx, ground, target);
			this.shown = target;
		}
		this.composite(gl, ctx, this.shown!);
	}

	/** Dev readout: the rough cache is on screen (the camera is moving, or hasn't settled yet). */
	get roughShown(): boolean {
		return this.shown !== null && this.shown === this.rough;
	}

	/** A moving camera marches the rough cache: `march.motionMode` 2, or 1 once moving frames ran slow. */
	get roughInMotion(): boolean {
		return this.motionMode >= 2 || (this.motionMode === 1 && this.slowMotion);
	}

	/**
	 * The renderer's frames run long. In automatic mode, if they were mostly moving frames (in motion the
	 * march is what costs), march the rough cache while the camera moves from now on, before the renderer
	 * lowers the resolution. Once for all: remembered on the device, until the mode changes in the panel.
	 */
	degrade(): boolean {
		if (this.motionMode !== 1 || this.slowMotion || this.motionShare < 0.5) return false;
		this.rememberSlowMotion(true);
		return true;
	}

	private rememberSlowMotion(slow: boolean) {
		this.slowMotion = slow;
		try {
			if (slow) localStorage.setItem(SLOW_MOTION_KEY, '1');
			else localStorage.removeItem(SLOW_MOTION_KEY);
		} catch {
			// storage unavailable: this visit only
		}
	}

	dispose(gl: WebGL2RenderingContext) {
		this.generation++; // ignore loads still in flight
		gl.deleteVertexArray(this.vao);
		this.vao = null;
		this.sharp = this.release(gl, this.sharp);
		this.rough = this.release(gl, this.rough);
		if (this.shadow) deleteColorTarget(gl, this.shadow);
		this.shadow = null;
		this.heightTexture = null; // textures stay in the renderer's per-context cache
		this.farTexture = null;
		this.zonesTexture = null;
		this.mapsTexture = null;
		this.noiseTexture = null;
		this.fade = 0;
	}

	/** `target` if it has the view's size at `scale`, else a new one (the old one deleted): re-marched before use. */
	private fit(gl: WebGL2RenderingContext, target: ColorDepthTarget | null, ctx: DrawContext, scale: number) {
		const width = Math.max(1, Math.round(ctx.rect.width * scale));
		const height = Math.max(1, Math.round(ctx.rect.height * scale));
		if (target && target.width === width && target.height === height) return target;
		this.release(gl, target);
		this.dirty = true;
		return createColorDepthTarget(gl, width, height);
	}

	private release(gl: WebGL2RenderingContext, target: ColorDepthTarget | null): null {
		if (!target) return null;
		deleteColorDepthTarget(gl, target);
		if (this.shown === target) this.shown = null;
		return null;
	}

	/** Raymarch the ground into the cache, then restore the renderer's target, viewport and scissor. */
	private march(gl: WebGL2RenderingContext, ctx: DrawContext, ground: Ground, cache: ColorDepthTarget) {
		const camera = this.camera;
		const { march, shading, fog, farField, shafts, water, zones } = this.settings;
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
		this.farRange[2] = ground.farBand;
		const [slabMin, slabMax] = ground.slab;
		this.slabVector[0] = slabMin;
		this.slabVector[1] = slabMax;
		const sm = this.shaftMarchVector;
		sm[0] = Math.max(0, Math.round(shafts.samples));
		sm[1] = shafts.softness;
		sm[2] = fog.density;

		const u = this.marchUniforms;
		u.uInvViewProj = camera.inverseViewProjection;
		u.uViewProj = camera.viewProjection;
		u.uCamPos = camera.eye;
		u.uHeightmap = this.heightTexture;
		u.uFarMap = this.farTexture ?? this.heightTexture;
		u.uMaps = this.mapsTexture;
		u.uSteps = march.steps;
		u.uRefineSteps = march.refineSteps;
		u.uStepScale = march.stepScale;
		u.uPrecision = march.precision;
		u.uMaxDistance = fog.end;
		u.uTint = shading.tint;
		u.uShadow = this.shadow!.color;
		u.uSeaLevel = water.level;
		u.uShallow = water.shallow;
		u.uDeep = water.deep;
		this.waterVector[0] = water.depth;
		this.waterVector[1] = water.foam;
		this.waterVector[2] = water.foamWidth;
		u.uZones = this.zonesTexture;
		u.uZone1 = zones.zone1;
		u.uZone2 = zones.zone2;
		u.uZone3 = zones.zone3;
		u.uZoneEdge = zones.edge;
		this.rockVector.set([zones.rock[0], zones.rock[1], zones.rock[2], zones.rockAmount]);
		this.rockSlopeVector.set([zones.rockSlope, Math.max(0.1, zones.rockSoftness)]);
		this.detailVector.set([zones.detail, zones.detailSize]);
		u.uNoise = this.noiseTexture;

		gl.disable(gl.SCISSOR_TEST);
		this.renderShadow(gl, this.shadow!); // also shades the terrain past the baked maps: needed with the shafts off
		gl.bindFramebuffer(gl.FRAMEBUFFER, cache.framebuffer);
		gl.viewport(0, 0, cache.width, cache.height);
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

	/**
	 * The shadow ceiling (shadow.frag) into its texture, when the ground it was rendered for changed (load, far
	 * field, shader reload). Walks toward the sun one texel at a time, until the sun ray clears the slab.
	 * Leaves the target bound: the march binds its own next.
	 */
	private renderShadow(gl: WebGL2RenderingContext, target: ColorTarget) {
		const f = this.farFieldVector;
		const sea = this.settings.water.level;
		const key = `${f[0]} ${f[1]} ${f[2]} ${f[3]} ${this.farRange[2]} ${sea} ${shaderGeneration}`;
		if (key === this.shadowKey) return;
		this.shadowKey = key;

		const [x, y, z] = this.assets.maps.sunDir;
		const run = Math.hypot(x, z);
		const step = 1 / (this.shadowBox[2] * SHADOW_SIZE);
		const range = this.slabVector[1] - this.slabVector[0];
		this.walkVector[0] = step;
		this.walkVector[1] = y > 0 && run > 1e-4 ? Math.min(256, Math.ceil((range * run) / y / step)) : 0;

		const u = this.shadowUniforms;
		u.uHeightmap = this.heightTexture;
		u.uFarMap = this.farTexture ?? this.heightTexture;
		u.uSeaLevel = sea;
		gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
		gl.viewport(0, 0, target.width, target.height);
		this.drawFullscreen(gl, this.shadowProgram!, u);
	}

	/** The cached ground under the live atmosphere, into the view. */
	private composite(gl: WebGL2RenderingContext, ctx: DrawContext, cache: ColorDepthTarget) {
		const camera = this.camera;
		const { fog, mist, wind, shafts, water } = this.settings;
		this.sunGlowVector[0] = fog.sunGlow;
		this.sunGlowVector[1] = fog.sunPower;
		// Shafts off: the cache's alpha is 1 (all lit), and lit mist keeps the plain sun glow
		const on = shafts.samples >= 1;
		this.shaftsVector[0] = on ? shafts.darkness : 0;
		this.shaftsVector[1] = on ? shafts.glow : 0;
		this.shaftsVector[2] = Math.max(1, shafts.power);
		const direction = (wind.direction * Math.PI) / 180; // compass, blowing toward: 0 = north (−Z)
		this.windVector[0] = Math.sin(direction);
		this.windVector[1] = -Math.cos(direction);

		const u = this.compositeUniforms;
		u.uColor = cache.color;
		u.uDepth = cache.depth;
		u.uInvViewProj = camera.inverseViewProjection;
		u.uCamPos = camera.eye;
		u.uFade = this.fade;
		u.uShaftView = shafts.view;
		u.uFogColor = fog.color;
		u.uSkyColor = fog.skyColor;
		u.uFogDensity = fog.density;
		u.uFogEnd = fog.end;
		u.uSunColor = fog.sunColor;
		u.uBankScale = mist.bankScale;
		u.uNoise = this.noiseTexture;
		u.uWindSpeed = wind.speed;
		u.uTime = this.time;
		// The sea's waves, reflection and glint (the cache already holds its colour)
		u.uSeaLevel = water.level;
		this.wavesVector.set([water.waveSize, water.waveSpeed, water.waves, water.waveFade]);
		this.seaVector.set([water.reflection, water.glint, Math.max(1, water.glintSize)]);
		u.uPixel = 2 / (camera.projection[5] * ctx.rect.height); // projection[5] = 1 / tan(fov / 2)
		u.uShadow = this.shadow!.color;
		this.drawFullscreen(gl, this.compositeProgram!, u);

		const scene = this.sceneUniforms;
		Object.assign(scene, u);
		scene.uHeightmap = this.heightTexture;
		scene.uBoundsMin = this.marchUniforms.uBoundsMin;
		scene.uBoundsMax = this.marchUniforms.uBoundsMax;
		scene.uFarField = this.farFieldVector;
		scene.uFarMap = this.farTexture ?? this.heightTexture;
		scene.uFarBounds = this.farBounds;
		scene.uFarRange = this.farRange;
		// Where the sun reaches the air (the light shafts' shadow ceiling), for passes that cast shadows in it
		scene.uShadow = this.shadow?.color ?? null;
		scene.uShadowBox = this.shadowBox;
		scene.uSlab = this.slabVector;
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

/** A 1×1 black texture: the zones without a zones file (no zone anywhere). */
function blackTexture(gl: WebGL2RenderingContext): WebGLTexture {
	const texture = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.bindTexture(gl.TEXTURE_2D, null);
	return texture;
}

// Shader hot reload (also when an included chunk changes: march, shade, shafts, terrain, fog, wind…)
if (import.meta.hot) {
	import.meta.hot.accept(
		['../../gl/fullscreen.vert', './terrain.frag', './composite.frag', './shadow.frag'],
		([v, m, c, s]) => {
			const nextVertex = v?.default ?? vertex;
			const nextMarch = m?.default ?? marchFragment;
			const nextComposite = c?.default ?? compositeFragment;
			const nextShadow = s?.default ?? shadowFragment;
			hotSwap([vertex, marchFragment], [nextVertex, nextMarch]);
			hotSwap([vertex, compositeFragment], [nextVertex, nextComposite]);
			hotSwap([vertex, shadowFragment], [nextVertex, nextShadow]);
			[vertex, marchFragment, compositeFragment, shadowFragment] = [nextVertex, nextMarch, nextComposite, nextShadow];
			shaderGeneration++;
		}
	);
}
