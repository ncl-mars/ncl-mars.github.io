import { m4, setUniforms } from 'twgl.js';
import layerVertexSource from './layer.vert';
import layerFragmentSource from './layer.frag';
import shellVertexSource from './shell.vert';
import shellFragmentSource from './shell.frag';
import { hotSwap, type Program } from '../../gl/programs';
import { createHalfFloatTexture } from '../../gl/textures';
import { loadRelief, type ReliefMeta } from '../../core/relief';
import type { Renderer } from '../../gl/renderer';
import type { DrawContext, Drawable, Frame } from '../../gl/types';

let layerVertex = layerVertexSource;
let layerFragment = layerFragmentSource;
let shellVertex = shellVertexSource;
let shellFragment = shellFragmentSource;

const MAX_LAYERS = 16; // matches shell.frag
const GRID = 128; // cells per side of a stratum's grid
const DEG = Math.PI / 180;

/** Read live every frame (the dev panel edits them). Angles in degrees; lengths in core widths. */
export interface CoreSettings {
	dip: number;
	dipVariation: number;
	spacing: number;
	relief: number;
	margin: number;
	xray: number;
	xrayColor: number[];
	mineral: number[];
	lightElevation: number;
	lightAzimuth: number;
	focusWidth: number;
	yaw: number;
	tilt: number;
	parallax: number;
	distance: number;
	fov: number;
	offsetX: number;
	smoothing: number;
}

/** One image stratum: its relief map (the colour image only lives in the HTML lightbox). */
export interface CoreLayer {
	reliefUrl: string;
	relief: ReliefMeta;
}

/**
 * The project viewer: a square core sample in the foreground, its images stacked inside as dipping
 * strata carved in relief (their depth maps, never their colour). The layer at the reading depth
 * (`focus`, eased toward `targetFocus` which the page sets from its scroll) is developed: opaque mineral
 * under a raking light. The others glow in X-ray, as does the shell with its edges and strata lines.
 * Everything blends premultiplied (alpha 0 = additive X-ray, 1 = opaque), layers sorted back to front.
 * `layerQuad(i)` gives each image's on-screen quad, so the page can lay HTML hit areas over it.
 */
export class CoreViewer implements Drawable {
	/** Reading depth in layers (0 = top), set by the page from its scroll. */
	targetFocus = 0;
	/** Eased reading depth. */
	focus = 0;
	/** Pointer in −1..1, for a little parallax. */
	readonly pointer = { x: 0, y: 0 };
	/** View size in CSS px, from the last draw (for the hit areas). */
	readonly cssSize = { width: 1, height: 1 };

	private layerProgram: Program | null = null;
	private shellProgram: Program | null = null;
	private gridVao: WebGLVertexArrayObject | null = null;
	private cubeVao: WebGLVertexArrayObject | null = null;
	private buffers: WebGLBuffer[] = [];
	private textures: (WebGLTexture | null)[];
	private generation = 0;
	private readonly parallax = [0, 0];

	private readonly model = m4.identity();
	private readonly view = m4.identity();
	private readonly projection = m4.identity();
	private readonly viewProjection = m4.identity();
	private readonly inverseModel = m4.identity();
	private readonly world = m4.identity();
	private readonly eye = [0, 0, 1];
	private readonly camLocal = [0, 0, 0];
	private readonly lightLocal = [0, 1, 0];
	private readonly bases = new Float32Array(MAX_LAYERS);
	private readonly slopes = new Float32Array(MAX_LAYERS * 2);
	private readonly xrayColor = new Float32Array(3);
	private readonly order: number[];
	private readonly depths: number[];
	private readonly layerUniforms: Record<string, unknown> = {};
	private readonly shellUniforms: Record<string, unknown> = {};

	constructor(
		private readonly settings: CoreSettings,
		private readonly layers: CoreLayer[]
	) {
		if (layers.length > MAX_LAYERS) throw new Error(`A core holds at most ${MAX_LAYERS} layers`);
		this.textures = layers.map(() => null);
		this.order = layers.map((_, i) => i);
		this.depths = layers.map(() => 0);
	}

	init(gl: WebGL2RenderingContext, renderer: Renderer) {
		this.layerProgram = renderer.program(layerVertex, layerFragment);
		this.shellProgram = renderer.program(shellVertex, shellFragment);
		this.createMeshes(gl);

		const generation = ++this.generation;
		this.layers.forEach((layer, i) => {
			renderer
				.resource(`relief:${layer.reliefUrl}`, (gl) =>
					loadRelief(layer.reliefUrl, layer.relief).then((r) =>
						createHalfFloatTexture(gl, r.meta.width, r.meta.height, r.half)
					)
				)
				.then((texture) => {
					if (generation === this.generation) this.textures[i] = texture;
				})
				.catch((error) => console.error('[core] relief loading failed:', error));
		});
	}

	update(frame: Frame) {
		const k = 1 - Math.exp(-frame.dt * this.settings.smoothing);
		this.focus += (this.targetFocus - this.focus) * k;
		if (Math.abs(this.targetFocus - this.focus) < 1e-4) this.focus = this.targetFocus;
		const p = 1 - Math.exp(-frame.dt * 4);
		this.parallax[0] += (this.pointer.x - this.parallax[0]) * p;
		this.parallax[1] += (this.pointer.y - this.parallax[1]) * p;
	}

	draw(gl: WebGL2RenderingContext, { rect, pixelRatio }: DrawContext) {
		this.cssSize.width = rect.width / pixelRatio;
		this.cssSize.height = rect.height / pixelRatio;
		this.updateMatrices(rect.width / rect.height);
		this.updateLayers();

		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied: alpha 0 adds, alpha 1 covers
		gl.disable(gl.DEPTH_TEST);
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.FRONT); // shell: back faces first
		this.drawShell(gl);
		gl.disable(gl.CULL_FACE);
		for (const i of this.order) this.drawLayer(gl, i);
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.BACK); // shell: front faces last
		this.drawShell(gl);
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.BLEND);
		gl.bindVertexArray(null);
	}

	dispose(gl: WebGL2RenderingContext) {
		this.generation++; // ignore loads still in flight
		gl.deleteVertexArray(this.gridVao);
		gl.deleteVertexArray(this.cubeVao);
		for (const buffer of this.buffers) gl.deleteBuffer(buffer);
		this.buffers = [];
		this.gridVao = this.cubeVao = null;
		this.textures = this.layers.map(() => null); // textures stay in the renderer's per-context cache
	}

	/** The image rectangle of layer i on screen (CSS px, TL, TR, BR, BL), or null if behind the camera. */
	layerQuad(i: number): [number, number][] | null {
		const [x0, y0, w, h] = this.imageRect(i);
		const corners: [number, number][] = [
			[x0, y0],
			[x0 + w, y0],
			[x0 + w, y0 + h],
			[x0, y0 + h]
		];
		const out: [number, number][] = [];
		for (const [u, v] of corners) {
			const x = u - 0.5;
			const z = v - 0.5;
			const local = [x, this.bases[i] + this.slopes[i * 2] * x + this.slopes[i * 2 + 1] * z, z];
			const p = m4.transformPoint(this.model, local);
			const m = this.viewProjection;
			const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
			const cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
			const cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
			if (cw <= 1e-6) return null;
			out.push([(cx / cw * 0.5 + 0.5) * this.cssSize.width, (0.5 - cy / cw * 0.5) * this.cssSize.height]);
		}
		return out;
	}

	private updateMatrices(aspect: number) {
		const s = this.settings;
		m4.perspective(s.fov * DEG, aspect, 0.05, 50, this.projection);
		this.eye[2] = s.distance;
		m4.lookAt(this.eye, [0, 0, 0], [0, 1, 0], this.world);
		m4.inverse(this.world, this.view);
		m4.multiply(this.projection, this.view, this.viewProjection);

		// Shifted aside for the text, tilted toward the camera (layer tops visible), turned to show two
		// walls, with a touch of pointer parallax; pivoting around the layer at the reading depth.
		m4.translation([s.offsetX, 0, 0], this.model);
		m4.rotateX(this.model, (s.tilt + this.parallax[1] * s.parallax * 0.5) * DEG, this.model);
		m4.rotateY(this.model, (s.yaw + this.parallax[0] * s.parallax) * DEG, this.model);
		m4.translate(this.model, [0, this.focus * s.spacing, 0], this.model);

		m4.inverse(this.model, this.inverseModel);
		const cam = m4.transformPoint(this.inverseModel, this.eye);
		this.camLocal[0] = cam[0];
		this.camLocal[1] = cam[1];
		this.camLocal[2] = cam[2];
		const el = s.lightElevation * DEG;
		const az = s.lightAzimuth * DEG;
		this.lightLocal[0] = Math.cos(el) * Math.cos(az);
		this.lightLocal[1] = Math.sin(el);
		this.lightLocal[2] = Math.cos(el) * Math.sin(az);
	}

	/** Each layer's plane (dipping a little differently), and the back-to-front drawing order. */
	private updateLayers() {
		const s = this.settings;
		for (let i = 0; i < this.layers.length; i++) {
			const r1 = fract(i * 0.6180339 + 0.31) * 2 - 1;
			const r2 = fract(i * 0.4142135 + 0.73) * 2 - 1;
			const dip = (s.dip + s.dipVariation * r1) * DEG;
			const azimuth = (25 + 35 * r2) * DEG;
			this.bases[i] = -i * s.spacing;
			this.slopes[i * 2] = Math.tan(dip) * Math.cos(azimuth);
			this.slopes[i * 2 + 1] = Math.tan(dip) * Math.sin(azimuth);
			const centre = m4.transformPoint(this.model, [0, this.bases[i], 0]);
			this.depths[i] = Math.hypot(centre[0] - this.eye[0], centre[1] - this.eye[1], centre[2] - this.eye[2]);
		}
		this.order.sort((a, b) => this.depths[b] - this.depths[a]);
		const c = s.xrayColor;
		this.xrayColor[0] = c[0] * s.xray;
		this.xrayColor[1] = c[1] * s.xray;
		this.xrayColor[2] = c[2] * s.xray;
	}

	/** The image inside layer i's uv square: aspect-fit with a margin. [x, y, width, height]. */
	private imageRect(i: number): [number, number, number, number] {
		const { width, height } = this.layers[i].relief;
		const aspect = width / height;
		const inner = 1 - 2 * this.settings.margin;
		const w = aspect >= 1 ? inner : inner * aspect;
		const h = aspect >= 1 ? inner / aspect : inner;
		return [(1 - w) / 2, (1 - h) / 2, w, h];
	}

	private drawLayer(gl: WebGL2RenderingContext, i: number) {
		const texture = this.textures[i];
		if (!texture) return;
		const s = this.settings;
		const distance = Math.abs(i - this.focus);
		const u = this.layerUniforms;
		u.uModel = this.model;
		u.uViewProj = this.viewProjection;
		u.uCamLocal = this.camLocal;
		u.uLightLocal = this.lightLocal;
		u.uRelief = texture;
		u.uImageRect = this.imageRect(i);
		u.uBase = this.bases[i];
		u.uSlope = [this.slopes[i * 2], this.slopes[i * 2 + 1]];
		u.uAmp = s.relief;
		u.uFocus = 1 - smoothstep(0.12, Math.max(0.13, s.focusWidth), distance);
		u.uGhost = Math.exp(-distance * 0.7);
		u.uXrayColor = this.xrayColor;
		u.uMineral = s.mineral;

		const info = this.layerProgram!.info;
		gl.useProgram(info.program);
		setUniforms(info, u);
		gl.bindVertexArray(this.gridVao);
		gl.drawElements(gl.TRIANGLES, GRID * GRID * 6, gl.UNSIGNED_SHORT, 0);
	}

	private drawShell(gl: WebGL2RenderingContext) {
		const s = this.settings;
		const n = this.layers.length;
		const cap = s.spacing * 0.8;
		const u = this.shellUniforms;
		u.uModel = this.model;
		u.uViewProj = this.viewProjection;
		u.uShellSize = [1, (n - 1) * s.spacing + 2 * cap, 1];
		u.uShellCenterY = (-(n - 1) * s.spacing) / 2;
		u.uLayerCount = n;
		u.uLayerBase = this.bases;
		u.uLayerSlope = this.slopes;
		u.uCamLocal = this.camLocal;
		u.uXrayColor = s.xrayColor;
		u.uXray = s.xray;

		const info = this.shellProgram!.info;
		gl.useProgram(info.program);
		setUniforms(info, u);
		gl.bindVertexArray(this.cubeVao);
		gl.drawArrays(gl.TRIANGLES, 0, 36);
	}

	/** A (GRID+1)² uv grid for the strata (attribute 0) and a unit cube for the shell (attribute 0). */
	private createMeshes(gl: WebGL2RenderingContext) {
		const n = GRID + 1;
		const uvs = new Float32Array(n * n * 2);
		for (let j = 0; j < n; j++) {
			for (let i = 0; i < n; i++) {
				uvs[(j * n + i) * 2] = i / GRID;
				uvs[(j * n + i) * 2 + 1] = j / GRID;
			}
		}
		const indices = new Uint16Array(GRID * GRID * 6);
		let k = 0;
		for (let j = 0; j < GRID; j++) {
			for (let i = 0; i < GRID; i++) {
				const a = j * n + i;
				const c = a + n;
				indices.set([a, c, a + 1, a + 1, c, c + 1], k);
				k += 6;
			}
		}
		this.gridVao = gl.createVertexArray();
		gl.bindVertexArray(this.gridVao);
		this.attribute(gl, uvs, 2);
		const indexBuffer = gl.createBuffer()!;
		this.buffers.push(indexBuffer);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

		// Unit cube, outward-facing counter-clockwise triangles: for each face, cross(u, v) = its normal
		const faces: [number[], number[], number[]][] = [
			[[1, 0, 0], [0, 1, 0], [0, 0, 1]],
			[[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
			[[0, 1, 0], [0, 0, 1], [1, 0, 0]],
			[[0, -1, 0], [1, 0, 0], [0, 0, 1]],
			[[0, 0, 1], [1, 0, 0], [0, 1, 0]],
			[[0, 0, -1], [0, 1, 0], [1, 0, 0]]
		];
		const positions: number[] = [];
		for (const [normal, fu, fv] of faces) {
			const corner = (su: number, sv: number) =>
				[0, 1, 2].map((a) => normal[a] * 0.5 + fu[a] * 0.5 * su + fv[a] * 0.5 * sv);
			positions.push(...corner(-1, -1), ...corner(1, -1), ...corner(1, 1));
			positions.push(...corner(-1, -1), ...corner(1, 1), ...corner(-1, 1));
		}
		this.cubeVao = gl.createVertexArray();
		gl.bindVertexArray(this.cubeVao);
		this.attribute(gl, new Float32Array(positions), 3);
		gl.bindVertexArray(null);
	}

	private attribute(gl: WebGL2RenderingContext, data: Float32Array, size: number) {
		const buffer = gl.createBuffer()!;
		this.buffers.push(buffer);
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, size, gl.FLOAT, false, 0, 0);
	}
}

function fract(x: number) {
	return x - Math.floor(x);
}

function smoothstep(a: number, b: number, v: number) {
	const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
	return t * t * (3 - 2 * t);
}

// Shader hot reload (also when ./core.glsl or /noise changes)
if (import.meta.hot) {
	import.meta.hot.accept(['./layer.vert', './layer.frag', './shell.vert', './shell.frag'], ([lv, lf, sv, sf]) => {
		const next = {
			lv: lv?.default ?? layerVertex,
			lf: lf?.default ?? layerFragment,
			sv: sv?.default ?? shellVertex,
			sf: sf?.default ?? shellFragment
		};
		hotSwap([layerVertex, layerFragment], [next.lv, next.lf]);
		hotSwap([shellVertex, shellFragment], [next.sv, next.sf]);
		[layerVertex, layerFragment, shellVertex, shellFragment] = [next.lv, next.lf, next.sv, next.sf];
	});
}
