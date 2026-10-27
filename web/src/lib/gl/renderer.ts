import type { Attachment } from 'svelte/attachments';
import { ProgramCache, type Program } from './programs';
import type { DrawContext, Drawable, Frame } from './types';

export interface RendererOptions {
	/** Upper bound for devicePixelRatio: the canvas never renders more pixels than this. */
	maxPixelRatio?: number;
}

/** Numbers for the perf HUD. Read a few times per second with `readStats()`, never reactive. */
export interface RendererStats {
	contextId: number;
	running: boolean;
	fps: number;
	frameMs: number;
	views: number;
	visibleViews: number;
	programs: number;
	compiles: number;
	width: number;
	height: number;
	pixelRatio: number;
}

interface View {
	el: HTMLElement;
	drawable: Drawable;
	/** Document-space rectangle in CSS pixels. Refreshed only from observer and resize callbacks. */
	x: number;
	y: number;
	width: number;
	height: number;
	visible: boolean;
	/** `init` succeeded for the current context. */
	ready: boolean;
	lastError: string | null;
}

let nextContextId = 1;

/**
 * Owns the site's single WebGL2 canvas (fixed behind the page, mounted by the root layout) and draws every
 * registered view into its element's rectangle with viewport + scissor.
 *
 * - Layout is never read inside the frame loop. Element rects are cached in document space from
 *   ResizeObserver / resize / font callbacks, and the scroll offset from scroll events. Each frame is arithmetic.
 * - The loop runs only while a view is on screen and the tab is visible.
 * - Safe to construct during prerender: nothing touches the DOM before `mount`. Views added before `mount`
 *   are initialised once the canvas exists.
 */
export class Renderer {
	gl: WebGL2RenderingContext | null = null;

	private readonly maxPixelRatio: number;
	private canvas: HTMLCanvasElement | null = null;
	private programs: ProgramCache | null = null;
	private views: View[] = [];
	private lost = false;

	private cssWidth = 0;
	private cssHeight = 0;
	private pixelRatio = 1;
	private scrollX = 0;
	private scrollY = 0;

	private raf = 0;
	private startTime = 0;
	private lastTime = 0;
	private readonly frame: Frame = { time: 0, dt: 0, index: 0 };
	private readonly drawContext: DrawContext = {
		frame: this.frame,
		rect: { x: 0, y: 0, width: 0, height: 0 },
		pixelRatio: 1,
		target: null
	};
	private readonly stats: RendererStats = {
		contextId: 0,
		running: false,
		fps: 0,
		frameMs: 0,
		views: 0,
		visibleViews: 0,
		programs: 0,
		compiles: 0,
		width: 0,
		height: 0,
		pixelRatio: 1
	};

	private resizeObserver: ResizeObserver | null = null;
	private listeners: AbortController | null = null;
	private pixelRatioQuery: MediaQueryList | null = null;

	constructor(options: RendererOptions = {}) {
		this.maxPixelRatio = options.maxPixelRatio ?? 2;
	}

	/** Attach to the canvas and start observing. Returns false when WebGL2 is unavailable. */
	mount(canvas: HTMLCanvasElement): boolean {
		const gl = canvas.getContext('webgl2', {
			alpha: true,
			depth: true,
			stencil: false,
			antialias: false,
			premultipliedAlpha: true
		});
		if (!gl) {
			console.warn('[renderer] WebGL2 is not available');
			return false;
		}
		this.canvas = canvas;
		this.startTime = performance.now();
		this.setContext(gl);

		const listeners = (this.listeners = new AbortController());
		const signal = listeners.signal;
		canvas.addEventListener('webglcontextlost', this.onContextLost, { signal });
		canvas.addEventListener('webglcontextrestored', this.onContextRestored, { signal });
		window.addEventListener('scroll', this.onScroll, { passive: true, signal });
		window.addEventListener('resize', this.measure, { signal });
		document.addEventListener('visibilitychange', this.updateLoop, { signal });
		document.fonts?.ready.then(() => this.canvas && this.measure());
		this.watchPixelRatio();

		// Views resizing, and the document resizing (content above a view changing height moves the view)
		this.resizeObserver = new ResizeObserver(this.measure);
		this.resizeObserver.observe(canvas);
		this.resizeObserver.observe(document.documentElement);
		for (const view of this.views) {
			this.resizeObserver.observe(view.el);
			this.initView(view);
		}
		this.measure();
		return true;
	}

	/** Stop everything and free the context right away (instead of waiting for GC). */
	unmount() {
		this.stopLoop();
		this.listeners?.abort();
		this.listeners = null;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		const gl = this.gl;
		if (gl && !this.lost) {
			for (const view of this.views) this.disposeView(view);
			this.programs?.destroy();
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		} else {
			this.programs?.release();
		}
		this.views = [];
		this.programs = null;
		this.gl = null;
		this.canvas = null;
	}

	/** Register a DOM element to draw `drawable` into. Returns the unregister function. */
	addView(el: HTMLElement, drawable: Drawable): () => void {
		const view: View = {
			el,
			drawable,
			x: 0,
			y: 0,
			width: 0,
			height: 0,
			visible: false,
			ready: false,
			lastError: null
		};
		this.views.push(view);
		if (this.canvas) {
			this.resizeObserver?.observe(el);
			this.initView(view);
			this.measure();
		}
		return () => this.removeView(view);
	}

	/** Svelte attachment: `<div {@attach renderer.view(drawable)}></div>`. */
	view(drawable: Drawable): Attachment<HTMLElement> {
		return (el) => this.addView(el, drawable);
	}

	/** Shared, cached program. Only valid between `init` and context loss. */
	program(vertex: string, fragment: string): Program {
		if (!this.programs) throw new Error('renderer.program() called before mount');
		return this.programs.get(vertex, fragment);
	}

	/**
	 * Re-read every view's rectangle. Runs from observer and resize callbacks. Call it yourself only when
	 * something moves a view without resizing it or the document (e.g. a CSS transform animation).
	 */
	measure = () => {
		const canvas = this.canvas;
		if (!canvas) return;
		const box = canvas.getBoundingClientRect();
		this.cssWidth = box.width;
		this.cssHeight = box.height;
		this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
		const width = Math.max(1, Math.round(box.width * this.pixelRatio));
		const height = Math.max(1, Math.round(box.height * this.pixelRatio));
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}

		this.scrollX = window.scrollX;
		this.scrollY = window.scrollY;
		for (const view of this.views) {
			const rect = view.el.getBoundingClientRect();
			view.x = rect.left + this.scrollX;
			view.y = rect.top + this.scrollY;
			view.width = rect.width;
			view.height = rect.height;
		}
		this.updateVisibility();
	};

	readStats(): RendererStats {
		const stats = this.stats;
		stats.views = this.views.length;
		stats.programs = this.programs?.size ?? 0;
		stats.compiles = this.programs?.compiles ?? 0;
		stats.width = this.canvas?.width ?? 0;
		stats.height = this.canvas?.height ?? 0;
		stats.pixelRatio = this.pixelRatio;
		stats.running = this.raf !== 0;
		return { ...stats };
	}

	// --- context ---------------------------------------------------------------------------------

	private setContext(gl: WebGL2RenderingContext) {
		this.gl = gl;
		this.programs = new ProgramCache(gl);
		this.stats.contextId = nextContextId++;
	}

	private onContextLost = (event: Event) => {
		event.preventDefault(); // allows the browser to restore the context later
		console.warn('[renderer] WebGL context lost');
		this.lost = true;
		for (const view of this.views) view.ready = false;
		this.programs?.release();
		this.updateLoop();
	};

	private onContextRestored = () => {
		console.warn('[renderer] WebGL context restored');
		this.lost = false;
		this.setContext(this.gl!);
		for (const view of this.views) this.initView(view);
		this.updateVisibility();
	};

	// --- views -----------------------------------------------------------------------------------

	private initView(view: View) {
		const gl = this.gl;
		if (!gl || this.lost) return;
		try {
			view.drawable.init?.(gl, this);
			view.ready = true;
		} catch (error) {
			this.report(view, 'init', error);
		}
	}

	private disposeView(view: View) {
		if (!view.ready || !this.gl) return;
		view.ready = false;
		try {
			view.drawable.dispose?.(this.gl);
		} catch (error) {
			this.report(view, 'dispose', error);
		}
	}

	private removeView(view: View) {
		const index = this.views.indexOf(view);
		if (index === -1) return;
		this.views.splice(index, 1);
		this.resizeObserver?.unobserve(view.el);
		if (!this.lost) this.disposeView(view);
		this.updateVisibility();
	}

	private onScroll = () => {
		this.scrollX = window.scrollX;
		this.scrollY = window.scrollY;
		this.updateVisibility();
	};

	/** Visibility from cached rects and the scroll offset: arithmetic only. */
	private updateVisibility() {
		const left = this.scrollX;
		const top = this.scrollY;
		const right = left + this.cssWidth;
		const bottom = top + this.cssHeight;
		let visible = 0;
		for (const view of this.views) {
			view.visible =
				view.width > 0 &&
				view.height > 0 &&
				view.x < right &&
				view.x + view.width > left &&
				view.y < bottom &&
				view.y + view.height > top;
			if (view.visible) visible++;
		}
		this.stats.visibleViews = visible;
		this.updateLoop();
	}

	/** devicePixelRatio changes (window moved to another screen) don't always fire a resize. */
	private watchPixelRatio() {
		this.pixelRatioQuery?.removeEventListener('change', this.onPixelRatioChange);
		this.pixelRatioQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
		this.pixelRatioQuery.addEventListener('change', this.onPixelRatioChange, {
			signal: this.listeners?.signal
		});
	}

	private onPixelRatioChange = () => {
		this.watchPixelRatio();
		this.measure();
	};

	// --- loop ------------------------------------------------------------------------------------

	private updateLoop = () => {
		const shouldRun =
			this.gl !== null &&
			!this.lost &&
			this.stats.visibleViews > 0 &&
			document.visibilityState === 'visible';
		if (shouldRun && !this.raf) {
			this.lastTime = performance.now();
			this.raf = requestAnimationFrame(this.tick);
		} else if (!shouldRun && this.raf) {
			this.stopLoop();
			// Nothing on screen any more: clear, or the fixed canvas keeps showing the last frame
			if (this.stats.visibleViews === 0 && this.gl && !this.lost) this.clear();
		}
	};

	private stopLoop() {
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	private tick = (now: number) => {
		this.raf = requestAnimationFrame(this.tick);
		const start = performance.now();
		const delta = (now - this.lastTime) / 1000;
		this.lastTime = now;

		const frame = this.frame;
		frame.time = (now - this.startTime) / 1000;
		frame.dt = Math.min(delta, 0.1);
		frame.index++;
		this.render(frame);

		const stats = this.stats;
		if (delta > 0) stats.fps += (1 / delta - stats.fps) * 0.1;
		stats.frameMs += (performance.now() - start - stats.frameMs) * 0.1;
	};

	private clear() {
		const gl = this.gl!;
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.disable(gl.SCISSOR_TEST);
		gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	}

	private render(frame: Frame) {
		const gl = this.gl!;
		this.clear();

		for (const view of this.views) {
			if (!view.visible || !view.ready || !view.drawable.update) continue;
			try {
				view.drawable.update(frame);
			} catch (error) {
				this.report(view, 'update', error);
			}
		}

		const ratio = this.pixelRatio;
		const canvasWidth = gl.drawingBufferWidth;
		const canvasHeight = gl.drawingBufferHeight;
		const ctx = this.drawContext;
		ctx.pixelRatio = ratio;
		ctx.target = null;
		gl.enable(gl.SCISSOR_TEST);

		for (const view of this.views) {
			if (!view.visible || !view.ready) continue;
			// Document space → viewport CSS px → device px, flipped to GL's bottom-left origin.
			// Edges are rounded separately so adjacent views never leave a 1 px gap.
			const x0 = Math.round((view.x - this.scrollX) * ratio);
			const x1 = Math.round((view.x + view.width - this.scrollX) * ratio);
			const y0 = canvasHeight - Math.round((view.y + view.height - this.scrollY) * ratio);
			const y1 = canvasHeight - Math.round((view.y - this.scrollY) * ratio);
			const width = x1 - x0;
			const height = y1 - y0;
			if (width <= 0 || height <= 0) continue;

			// The viewport may extend past the canvas (partly scrolled-out view); the scissor clips to it
			const sx = Math.max(0, x0);
			const sy = Math.max(0, y0);
			const sw = Math.min(canvasWidth, x1) - sx;
			const sh = Math.min(canvasHeight, y1) - sy;
			if (sw <= 0 || sh <= 0) continue;
			gl.viewport(x0, y0, width, height);
			gl.scissor(sx, sy, sw, sh);

			const rect = ctx.rect;
			rect.x = x0;
			rect.y = y0;
			rect.width = width;
			rect.height = height;
			try {
				view.drawable.draw(gl, ctx);
			} catch (error) {
				this.report(view, 'draw', error);
			}
		}
		gl.disable(gl.SCISSOR_TEST);
	}

	/** Log each distinct error once per view, so a failing drawable doesn't flood the console every frame. */
	private report(view: View, phase: string, error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		if (view.lastError === message) return;
		view.lastError = message;
		console.error(`[renderer] ${phase} failed:`, error);
	}
}
