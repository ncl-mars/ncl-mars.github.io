import { m4, setUniforms } from 'twgl.js';
import vertexSource from '../../gl/fullscreen.vert';
import fragmentSource from './core.frag';
import { hotSwap, type Program } from '../../gl/programs';
import { createHalfFloatTexture } from '../../gl/textures';
import { createHashTexture, createNoiseTexture3D } from '../../gl/noise';
import { loadRelief, type ReliefMeta } from '../../core/relief';
import type { Renderer } from '../../gl/renderer';
import type { DrawContext, Drawable, Frame } from '../../gl/types';

let vertex = vertexSource;
let fragment = fragmentSource;

const DEG = Math.PI / 180;

/** Read live every frame (the dev panel edits them). Angles in degrees; lengths in core widths. */
export interface CoreSettings {
	spacing: number;
	micro: number;
	margin: number;
	emerge: number;
	sand: number;
	topNoise: number;
	topScale: number;
	sideNoise: number;
	sideScale: number;
	band: number;
	warp: number;
	dip: number;
	strata: number;
	grain: number;
	noiseScale: number;
	mineral: number[];
	mineral2: number[];
	lightElevation: number;
	lightAzimuth: number;
	shadow: number;
	ao: number;
	steps: number;
	yaw: number;
	tilt: number;
	parallax: number;
	distance: number;
	fov: number;
	offsetX: number;
	smoothing: number;
}

/** One image of the core: its relief map (the colour image only lives in the HTML lightbox). */
export interface CoreLayer {
	reliefUrl: string;
	relief: ReliefMeta;
}

export interface CoreViewerOptions {
	/** Opaque colour painted behind the core when it's drawn on its own (no scene underneath). */
	backdrop?: () => number[];
}

/**
 * The project viewer: a core sample of rock in the foreground, raymarched (core.frag, rock.glsl). Its top
 * is the cut: scrolling removes matter (the cut descends) or stacks it back. The images are buried one
 * strata thickness apart; as the cut comes down to one, its relief emerges (highest parts first), then
 * gets sanded flat below it: tied to the cut by construction. `focus` is the cut depth in images
 * (0 = first image), eased toward `targetFocus`, which the page sets from its scroll. `layerQuad(i)` gives
 * image i's on-screen quad on the cut face while it's exposed, so the page can lay a hit area over it.
 */
export class CoreViewer implements Drawable {
	/** Cut depth in images (0 = first), set by the page from its scroll. */
	targetFocus = 0;
	/** Eased cut depth. */
	focus = 0;
	/** Pointer in −1..1, for a little parallax. */
	readonly pointer = { x: 0, y: 0 };
	/** View size in CSS px, from the last draw (for the hit areas). */
	readonly cssSize = { width: 1, height: 1 };
	/** Dev readout: frames drawn, relief maps loaded. */
	readonly stats = { frames: 0, reliefs: 0 };

	private program: Program | null = null;
	private vao: WebGLVertexArrayObject | null = null;
	private noise3D: WebGLTexture | null = null;
	private hash: WebGLTexture | null = null;
	private textures: (WebGLTexture | null)[];
	private generation = 0;
	private readonly parallax = [0, 0];

	private readonly model = m4.identity();
	private readonly view = m4.identity();
	private readonly projection = m4.identity();
	private readonly viewProjection = m4.identity();
	private readonly mvp = m4.identity();
	private readonly inverseMvp = m4.identity();
	private readonly inverseModel = m4.identity();
	private readonly world = m4.identity();
	private readonly eye = [0, 0, 1];
	private readonly camLocal = [0, 0, 0];
	private readonly lightLocal = [0, 1, 0];
	private readonly uniforms: Record<string, unknown> = {};

	constructor(
		private readonly settings: CoreSettings,
		private readonly layers: CoreLayer[],
		private readonly options: CoreViewerOptions = {}
	) {
		this.textures = layers.map(() => null);
	}

	init(gl: WebGL2RenderingContext, renderer: Renderer) {
		this.program = renderer.program(vertex, fragment);
		this.vao = gl.createVertexArray(); // empty: fullscreen.vert builds the triangle from gl_VertexID
		// Shared per context: generated once, reused by every drawable that needs smooth noise
		this.noise3D = renderer.resource('noise:3d', (gl) => createNoiseTexture3D(gl));
		this.hash = renderer.resource('noise:hash', (gl) => createHashTexture(gl));

		const generation = ++this.generation;
		this.layers.forEach((layer, i) => {
			renderer
				.resource(`relief:${layer.reliefUrl}`, (gl) =>
					loadRelief(layer.reliefUrl, layer.relief).then((r) =>
						createHalfFloatTexture(gl, r.meta.width, r.meta.height, r.half)
					)
				)
				.then((texture) => {
					if (generation !== this.generation) return;
					this.textures[i] = texture;
					this.stats.reliefs++;
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
		this.stats.frames++;
		this.cssSize.width = rect.width / pixelRatio;
		this.cssSize.height = rect.height / pixelRatio;
		this.updateMatrices(rect.width / rect.height);

		const backdrop = this.options.backdrop?.();
		if (backdrop) {
			gl.clearColor(backdrop[0], backdrop[1], backdrop[2], 1); // within the view's scissor
			gl.clear(gl.COLOR_BUFFER_BIT);
		}

		const s = this.settings;
		const n = this.layers.length;
		// The two images nearest the cut (only these can be exposed: emerge + sand ≤ one strata thickness)
		const a = Math.min(n - 1, Math.max(0, Math.round(this.focus)));
		const b = Math.min(n - 1, Math.max(0, this.focus >= a ? a + 1 : a - 1));
		const activeA = this.textures[a] ? 1 : 0;
		const activeB = b !== a && this.textures[b] ? 1 : 0;
		const dip = s.dip * DEG;

		const u = this.uniforms;
		u.uNoise3D = this.noise3D;
		u.uHash = this.hash;
		u.uInvMvp = this.inverseMvp;
		u.uMvp = this.mvp;
		u.uCamLocal = this.camLocal;
		u.uLightLocal = this.lightLocal;
		u.uSteps = s.steps;
		u.uShade = [s.shadow, s.ao];
		u.uCut = this.cut();
		u.uBottom = -(n - 1) * s.spacing - s.spacing * 1.5;
		u.uTopNoise = [s.topNoise, s.topScale];
		u.uSideNoise = [s.sideNoise, s.sideScale];
		u.uReliefA = this.textures[a] ?? this.anyTexture();
		u.uReliefB = this.textures[b] ?? this.anyTexture();
		u.uRectA = this.imageRect(a);
		u.uRectB = this.imageRect(b);
		u.uDepths = [this.depth(a), this.depth(b)];
		u.uActive = [activeA, activeB];
		u.uMicro = s.micro;
		u.uEmerge = s.emerge * s.spacing;
		u.uSand = Math.max(1e-3, s.sand * s.spacing);
		u.uBand = Math.max(1e-3, s.band);
		u.uWarp = s.warp;
		u.uDip = [Math.tan(dip) * 0.8, Math.tan(dip) * 0.6];
		u.uMineral = s.mineral;
		u.uMineral2 = s.mineral2;
		u.uStrata = s.strata;
		u.uGrain = s.grain;
		u.uNoiseScale = s.noiseScale;

		const info = this.program!.info;
		gl.useProgram(info.program);
		gl.bindVertexArray(this.vao);
		setUniforms(info, u);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.ALWAYS); // the raymarch decides the depth
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.depthFunc(gl.LESS);
		gl.disable(gl.DEPTH_TEST);
		gl.bindVertexArray(null);
	}

	dispose(gl: WebGL2RenderingContext) {
		this.generation++; // ignore loads still in flight
		gl.deleteVertexArray(this.vao);
		this.vao = null;
		// Textures (reliefs, noise) stay in the renderer's per-context cache
		this.textures = this.layers.map(() => null);
		this.noise3D = this.hash = null;
	}

	/** Image i's rectangle on the cut face on screen (CSS px, TL, TR, BR, BL), or null while it isn't exposed. */
	layerQuad(i: number): [number, number][] | null {
		if (!this.textures[i] || this.exposure(i) < 0.5) return null;
		const [x0, y0, w, h] = this.imageRect(i);
		const cut = this.cut();
		const out: [number, number][] = [];
		for (const [u, v] of [
			[x0, y0],
			[x0 + w, y0],
			[x0 + w, y0 + h],
			[x0, y0 + h]
		]) {
			const p = m4.transformPoint(this.model, [u - 0.5, cut, v - 0.5]);
			const m = this.viewProjection;
			const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
			const cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
			const cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
			if (cw <= 1e-6) return null;
			out.push([((cx / cw) * 0.5 + 0.5) * this.cssSize.width, (0.5 - (cy / cw) * 0.5) * this.cssSize.height]);
		}
		return out;
	}

	/** Height of the cut in local space (images sit at depth(i)). */
	private cut() {
		return -this.focus * this.settings.spacing;
	}

	private depth(i: number) {
		return -i * this.settings.spacing;
	}

	/** How exposed image i is overall (its mid-relief), as in rock.glsl's exposure(): for the hit area. */
	private exposure(i: number) {
		const s = this.settings;
		const emerge = Math.max(1e-3, s.emerge * s.spacing);
		const sand = Math.max(1e-3, s.sand * s.spacing);
		const c = this.cut();
		const d = this.depth(i);
		const emerged = Math.min(1, Math.max(0, (d + emerge * 0.5 - c) / (emerge * 0.5)));
		return emerged * (1 - smoothstep(0, sand, d - c));
	}

	/** The image inside the top square's uv: aspect-fit with a margin. [x, y, width, height]. */
	private imageRect(i: number): [number, number, number, number] {
		const { width, height } = this.layers[i].relief;
		const aspect = width / height;
		const inner = 1 - 2 * this.settings.margin;
		const w = aspect >= 1 ? inner : inner * aspect;
		const h = aspect >= 1 ? inner / aspect : inner;
		return [(1 - w) / 2, (1 - h) / 2, w, h];
	}

	/** Any loaded relief texture (unused samplers still need one bound). */
	private anyTexture() {
		return this.textures.find((t) => t) ?? null;
	}

	private updateMatrices(aspect: number) {
		const s = this.settings;
		m4.perspective(s.fov * DEG, aspect, 0.05, 50, this.projection);
		this.eye[2] = s.distance;
		m4.lookAt(this.eye, [0, 0, 0], [0, 1, 0], this.world);
		m4.inverse(this.world, this.view);
		m4.multiply(this.projection, this.view, this.viewProjection);

		// Shifted aside for the text, tilted toward the camera (the cut face visible), turned to show two
		// walls, with a touch of pointer parallax; pivoting around the cut, so it stays framed as you dig.
		m4.translation([s.offsetX, 0, 0], this.model);
		m4.rotateX(this.model, (s.tilt + this.parallax[1] * s.parallax * 0.5) * DEG, this.model);
		m4.rotateY(this.model, (s.yaw + this.parallax[0] * s.parallax) * DEG, this.model);
		m4.translate(this.model, [0, this.focus * s.spacing, 0], this.model);

		m4.multiply(this.viewProjection, this.model, this.mvp);
		m4.inverse(this.mvp, this.inverseMvp);
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
}

function smoothstep(a: number, b: number, v: number) {
	const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
	return t * t * (3 - 2 * t);
}

// Shader hot reload (also when ./rock.glsl or /noise changes)
if (import.meta.hot) {
	import.meta.hot.accept(['../../gl/fullscreen.vert', './core.frag'], ([v, f]) => {
		const next: [string, string] = [v?.default ?? vertex, f?.default ?? fragment];
		hotSwap([vertex, fragment], next);
		[vertex, fragment] = next;
	});
}
