import { setUniforms } from 'twgl.js';
import sheetVertexSource from './sheet.vert';
import sheetFragmentSource from './sheet.frag';
import labelVertexSource from './label.vert';
import labelFragmentSource from './label.frag';
import { hotSwap, type Program } from '../../gl/programs';
import { LegendLines, type LabelText } from '../../legend/lines';
import type { SurveyCamera } from '../../gl/camera';
import type { Renderer } from '../../gl/renderer';
import type { DrawContext, Drawable } from '../../gl/types';
import type { Terrain } from '../terrain/Terrain';

let sheetVertex = sheetVertexSource;
let sheetFragment = sheetFragmentSource;
let labelVertex = labelVertexSource;
let labelFragment = labelFragmentSource;

/** Read live every frame (tuning.legendShadows, the dev panel edits it). See schema.ts. */
export interface LegendShadowSettings {
	strength: number;
	thickness: number;
	maxLength: number;
	ground: number;
	softness: number;
	text: number;
	textSoftness: number;
	textAir: number;
	textSamples: number;
}

/** The text masks' atlas: one row per label, its text scaled to fit (R8, mipmapped for the penumbra). */
const ATLAS_WIDTH = 1024;
const ROW_HEIGHT = 96;
/** Rows a 2048-texel atlas holds (WebGL2's guaranteed size): labels past this get no text shadow. ≤ 32 (uRowScale). */
export const MAX_LABEL_SHADOWS = Math.floor(2048 / ROW_HEIGHT);
/** Texels kept empty under and right of each mask, so mipmaps don't bleed into the next row. */
const PAD = 8;

/** A unit box, 12 triangles: x and y from 0 to 1, z from `zMin` to 1. */
function unitBox(zMin: number): Float32Array {
	const c = [
		[0, 0, zMin], [1, 0, zMin], [1, 1, zMin], [0, 1, zMin],
		[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
	];
	const faces = [
		[0, 1, 2, 0, 2, 3], [4, 6, 5, 4, 7, 6], [0, 4, 5, 0, 5, 1],
		[3, 2, 6, 3, 6, 7], [0, 3, 7, 0, 7, 4], [1, 5, 6, 1, 6, 2]
	];
	return new Float32Array(faces.flat().flatMap((i) => c[i]));
}

/** Segment boxes: x along the segment, y along the shadow, z across (±1). Label boxes: x, y across the text, z along the shadow. */
const SHEET_BOX = unitBox(-1);
const LABEL_BOX = unitBox(0);

/**
 * The legend's shadows, from what the legend writes after each frame (LegendLines): each segment of a shown
 * label casts a thin sheet of shadow through the air, away from the sun, and a line on the ground
 * (sheet.frag works out how much); each label's text shades the ground with its letters (label.frag, from
 * a mask of the text drawn with the same fonts). Drawn after the terrain in the same view, before the dust:
 * boxes depth-tested against the ground, never writing depth, darkening what is under them. Takes the
 * ground, the atmosphere and the shadow ceiling from the terrain (`sceneUniforms`). The labels move, so this
 * runs every frame, but only the pixels the boxes cover pay, and nothing is drawn while no label is shown.
 */
export class LegendShadows implements Drawable {
	private sheetProgram: Program | null = null;
	private labelProgram: Program | null = null;
	private sheetVao: WebGLVertexArrayObject | null = null;
	private labelVao: WebGLVertexArrayObject | null = null;
	private buffers: WebGLBuffer[] = [];
	private sheetInstances: WebGLBuffer | null = null;
	private labelInstances: WebGLBuffer | null = null;
	private masks: WebGLTexture | null = null;
	private canvas: CanvasRenderingContext2D | null = null;
	/** The text revision each atlas row was drawn from (−1: not yet). */
	private drawn = new Int32Array(0);
	private rows = 0;
	private readonly rowScale = new Float32Array(64);
	private readonly atlas = new Float32Array(3);
	private readonly sheet = new Float32Array(4);
	private readonly text = new Float32Array(4);
	private readonly viewport = new Float32Array(4);
	private readonly uniforms: Record<string, unknown>;

	constructor(
		private readonly camera: SurveyCamera,
		private readonly terrain: Terrain,
		private readonly lines: LegendLines,
		private readonly settings: LegendShadowSettings
	) {
		this.uniforms = {
			uSheet: this.sheet,
			uText: this.text,
			uViewport: this.viewport,
			uRowScale: this.rowScale,
			uAtlas: this.atlas
		};
	}

	init(gl: WebGL2RenderingContext, renderer: Renderer) {
		this.sheetProgram = renderer.program(sheetVertex, sheetFragment);
		this.labelProgram = renderer.program(labelVertex, labelFragment);

		// Per segment: start, end, line (pixel size, visibility); per label: corner, x axis, y axis, label
		// (row, visibility). Locations fixed in the vertex shaders
		this.sheetInstances = gl.createBuffer();
		this.sheetVao = this.createVao(gl, SHEET_BOX, this.sheetInstances, this.lines.data.byteLength, LegendLines.STRIDE, [
			[3, 0],
			[3, 3],
			[2, 6]
		]);
		this.labelInstances = gl.createBuffer();
		this.labelVao = this.createVao(gl, LABEL_BOX, this.labelInstances, this.lines.labels.byteLength, LegendLines.LABEL_STRIDE, [
			[3, 0],
			[3, 3],
			[3, 6],
			[2, 9]
		]);

		this.rows = Math.min(this.lines.labelCapacity, MAX_LABEL_SHADOWS);
		this.masks = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, this.masks);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, ATLAS_WIDTH, Math.max(1, this.rows) * ROW_HEIGHT, 0, gl.RED, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.generateMipmap(gl.TEXTURE_2D);
		gl.bindTexture(gl.TEXTURE_2D, null);
		this.drawn = new Int32Array(this.rows).fill(-1);

		const canvas = document.createElement('canvas');
		canvas.width = ATLAS_WIDTH;
		canvas.height = ROW_HEIGHT;
		this.canvas = canvas.getContext('2d', { willReadFrequently: true });
	}

	draw(gl: WebGL2RenderingContext, ctx: DrawContext) {
		const scene = this.terrain.sceneUniforms;
		const s = this.settings;
		const lines = this.lines;
		const sheets = s.strength > 0 || s.ground > 0 ? lines.count : 0;
		const labels = s.text > 0 || s.textAir > 0 ? Math.min(lines.labelCount, this.rows) : 0;
		if (!scene.uHeightmap || !scene.uShadow || (sheets === 0 && labels === 0)) return;
		if (labels > 0) this.updateMasks(gl);

		this.sheet[0] = s.strength;
		this.sheet[1] = Math.max(0.1, s.thickness);
		this.sheet[2] = Math.max(1, s.maxLength);
		this.sheet[3] = Math.min(1, Math.max(0, s.ground));
		this.text[0] = Math.min(1, Math.max(0, s.text));
		this.text[1] = Math.max(0, s.textSoftness);
		this.text[2] = Math.max(0, s.textAir);
		this.text[3] = Math.min(16, Math.max(1, Math.round(s.textSamples)));
		this.atlas[0] = Math.max(1, this.rows);
		this.atlas[1] = ATLAS_WIDTH;
		this.atlas[2] = ROW_HEIGHT;
		const { rect } = ctx;
		this.viewport.set([rect.x, rect.y, rect.width, rect.height]);
		const u = this.uniforms;
		u.uViewProj = this.camera.viewProjection;
		u.uMasks = this.masks;
		u.uSoftness = Math.max(0, s.softness);

		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LESS);
		gl.depthMask(false);
		gl.enable(gl.BLEND);
		// Darken the colour only, channel by channel: dst × (1 − src), the canvas alpha (the fade-in over the
		// page) untouched
		gl.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE);
		if (sheets > 0) {
			this.drawBoxes(gl, this.sheetProgram!, this.sheetVao, this.sheetInstances, lines.data, LegendLines.STRIDE, SHEET_BOX, sheets);
		}
		if (labels > 0) {
			this.drawBoxes(gl, this.labelProgram!, this.labelVao, this.labelInstances, lines.labels, LegendLines.LABEL_STRIDE, LABEL_BOX, labels);
		}
		gl.disable(gl.BLEND);
		gl.depthMask(true);
		gl.disable(gl.DEPTH_TEST);
	}

	dispose(gl: WebGL2RenderingContext) {
		gl.deleteVertexArray(this.sheetVao);
		gl.deleteVertexArray(this.labelVao);
		for (const buffer of this.buffers) gl.deleteBuffer(buffer);
		gl.deleteTexture(this.masks);
		this.sheetVao = this.labelVao = this.sheetInstances = this.labelInstances = this.masks = null;
		this.buffers = [];
		this.canvas = null;
	}

	/** A VAO: the unit box's corners (location 0), and the per-instance attributes (locations 1…), as [size, offset in floats]. */
	private createVao(
		gl: WebGL2RenderingContext,
		box: Float32Array,
		instances: WebGLBuffer | null,
		bytes: number,
		stride: number,
		attributes: [number, number][]
	): WebGLVertexArrayObject {
		const vao = gl.createVertexArray()!;
		gl.bindVertexArray(vao);
		const corners = gl.createBuffer()!;
		this.buffers.push(corners, instances!);
		gl.bindBuffer(gl.ARRAY_BUFFER, corners);
		gl.bufferData(gl.ARRAY_BUFFER, box, gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
		gl.bindBuffer(gl.ARRAY_BUFFER, instances);
		gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
		attributes.forEach(([size, offset], i) => {
			gl.enableVertexAttribArray(i + 1);
			gl.vertexAttribPointer(i + 1, size, gl.FLOAT, false, stride * 4, offset * 4);
			gl.vertexAttribDivisor(i + 1, 1);
		});
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		return vao;
	}

	private drawBoxes(
		gl: WebGL2RenderingContext,
		program: Program,
		vao: WebGLVertexArrayObject | null,
		instances: WebGLBuffer | null,
		data: Float32Array,
		stride: number,
		box: Float32Array,
		count: number
	) {
		gl.bindBuffer(gl.ARRAY_BUFFER, instances);
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * stride);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		gl.useProgram(program.info.program);
		gl.bindVertexArray(vao);
		setUniforms(program.info, this.terrain.sceneUniforms);
		setUniforms(program.info, this.uniforms);
		gl.drawArraysInstanced(gl.TRIANGLES, 0, box.length / 3, count);
		gl.bindVertexArray(null);
	}

	/** Redraw the masks whose label's text changed (rare: a new label, the current POI, the text size), then the mipmaps. */
	private updateMasks(gl: WebGL2RenderingContext) {
		const canvas = this.canvas;
		if (!canvas) return;
		let changed = false;
		for (let row = 0; row < this.rows; row++) {
			const text = this.lines.texts[row];
			if (!text || text.revision === this.drawn[row]) continue;
			this.drawn[row] = text.revision;
			this.drawMask(gl, canvas, row, text);
			changed = true;
		}
		if (!changed) return;
		gl.bindTexture(gl.TEXTURE_2D, this.masks);
		gl.generateMipmap(gl.TEXTURE_2D);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	/**
	 * One label's text, white on nothing, into its atlas row: as Legend.svelte lays it out in its text box
	 * (lines.box, in em): the title in capitals, 0.16em apart, centred in its 1.2 line 0.45em above the shelf;
	 * the coordinates in mono at 0.9em, 0.04em apart, 0.5em under it; left-aligned, or right-aligned on the
	 * left side. Only the coverage (alpha) is kept.
	 */
	private drawMask(gl: WebGL2RenderingContext, canvas: CanvasRenderingContext2D, row: number, text: LabelText) {
		const { fonts, box } = this.lines;
		const em = text.size;
		const width = Math.max(1, text.width);
		const height = (box.above + box.below) * em;
		const scale = Math.min((ATLAS_WIDTH - PAD) / width, (ROW_HEIGHT - PAD) / height);
		canvas.clearRect(0, 0, ATLAS_WIDTH, ROW_HEIGHT);
		canvas.save();
		canvas.scale(scale, scale);
		canvas.fillStyle = '#fff';
		canvas.textBaseline = 'middle';
		canvas.font = `${text.bold ? 700 : 500} ${em}px ${fonts.sans}`;
		spaced(canvas, text.title.toUpperCase(), 0.16 * em, (box.above - 0.45 - 0.6) * em, text.side, width);
		const meta = 0.9 * em;
		canvas.font = `${meta}px ${fonts.mono}`;
		spaced(canvas, text.meta, 0.04 * meta, (box.above + 0.5) * em + 0.6 * meta, text.side, width);
		canvas.restore();

		const rgba = canvas.getImageData(0, 0, ATLAS_WIDTH, ROW_HEIGHT).data;
		const alpha = new Uint8Array(ATLAS_WIDTH * ROW_HEIGHT);
		for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
		gl.bindTexture(gl.TEXTURE_2D, this.masks);
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row * ROW_HEIGHT, ATLAS_WIDTH, ROW_HEIGHT, gl.RED, gl.UNSIGNED_BYTE, alpha);
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
		gl.bindTexture(gl.TEXTURE_2D, null);
		this.rowScale[row * 2] = (width * scale) / ATLAS_WIDTH;
		this.rowScale[row * 2 + 1] = (height * scale) / ROW_HEIGHT;
	}
}

/**
 * Text with CSS letter-spacing (after every letter, the last one included), letter by letter: canvas
 * letterSpacing isn't in every browser yet. Left-aligned at 0 (`side` 1), or ending at `width`.
 */
function spaced(canvas: CanvasRenderingContext2D, text: string, spacing: number, y: number, side: number, width: number) {
	const letters = [...text];
	const widths = letters.map((letter) => canvas.measureText(letter).width);
	const total = widths.reduce((sum, w) => sum + w + spacing, 0);
	let x = side === -1 ? width - total : 0;
	letters.forEach((letter, i) => {
		canvas.fillText(letter, x, y);
		x += widths[i] + spacing;
	});
}

// Shader hot reload (also when an included chunk changes: noise, wind, fog)
if (import.meta.hot) {
	import.meta.hot.accept(['./sheet.vert', './sheet.frag', './label.vert', './label.frag'], ([sv, sf, lv, lf]) => {
		const sheet: [string, string] = [sv?.default ?? sheetVertex, sf?.default ?? sheetFragment];
		const label: [string, string] = [lv?.default ?? labelVertex, lf?.default ?? labelFragment];
		hotSwap([sheetVertex, sheetFragment], sheet);
		hotSwap([labelVertex, labelFragment], label);
		[sheetVertex, sheetFragment] = sheet;
		[labelVertex, labelFragment] = label;
	});
}
