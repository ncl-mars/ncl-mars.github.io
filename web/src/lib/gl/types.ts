import type { Renderer } from './renderer';

/** Timing for the current frame, shared by every drawable. */
export interface Frame {
	/** Seconds since the renderer was mounted. */
	time: number;
	/** Seconds since the previous frame, clamped to 0.1 so a resumed tab doesn't jump. */
	dt: number;
	/** Frame counter. */
	index: number;
}

/** A rectangle in device pixels, origin bottom-left (GL convention). */
export interface PixelRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * What a drawable receives when it draws. The viewport and scissor are already set to `rect`.
 * The renderer reuses this object every frame: read it, don't keep it.
 */
export interface DrawContext {
	frame: Frame;
	/** The view's rectangle in the current target. */
	rect: PixelRect;
	/** The scissor box set by the renderer (`rect` clipped to the target): restore it after offscreen work. */
	scissor: PixelRect;
	/** CSS pixels → device pixels (devicePixelRatio, capped by the renderer). */
	pixelRatio: number;
	/** Framebuffer being drawn into; null is the canvas. */
	target: WebGLFramebuffer | null;
}

/**
 * Something drawn into a view. Constructors must not touch the DOM or GL (pages are prerendered in Node):
 * create GL resources in `init`. Pass order (opaque → transparent) is the drawable's business.
 */
export interface Drawable {
	/** Create GL resources. Called when the view is registered, and again after a context restore. */
	init?(gl: WebGL2RenderingContext, renderer: Renderer): void;
	/** Once per frame, before any view is drawn, while the view is visible. */
	update?(frame: Frame): void;
	draw(gl: WebGL2RenderingContext, ctx: DrawContext): void;
	/**
	 * Frames are running long (under ~52 fps): get cheaper if you can, and return true if you did. Asked
	 * before the renderer lowers the resolution, so a drawable's own fallback goes first. Nothing undoes it.
	 */
	degrade?(): boolean;
	/** Release GL resources. Programs are shared and stay cached. Not called after a context loss. */
	dispose?(gl: WebGL2RenderingContext): void;
}
