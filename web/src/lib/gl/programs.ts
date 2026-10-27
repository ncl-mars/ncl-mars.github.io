import { createProgramInfo, type ProgramInfo } from 'twgl.js';

/** A compiled program, shared by every drawable using the same sources. Hot reload swaps `info` in place. */
export interface Program {
	info: ProgramInfo;
}

type Sources = [vertex: string, fragment: string];

const liveCaches = new Set<ProgramCache>();

/**
 * Compiles each (vertex, fragment) source pair once and keeps it for the life of the context, so drawables
 * re-created by client-side navigation reuse their programs instead of recompiling them.
 */
export class ProgramCache {
	/** Successful compiles since this context was created (shown in the perf HUD). */
	compiles = 0;
	private programs = new Map<string, Program>();

	constructor(private gl: WebGL2RenderingContext) {
		liveCaches.add(this);
	}

	get size() {
		return this.programs.size;
	}

	/** The cached program for these sources, compiled on first use. Throws if it doesn't compile. */
	get(vertex: string, fragment: string): Program {
		const key = keyOf([vertex, fragment]);
		let program = this.programs.get(key);
		if (!program) {
			const info = this.compile([vertex, fragment]);
			if (!info) throw new Error('Shader program failed to compile (error logged above)');
			program = { info };
			this.programs.set(key, program);
		}
		return program;
	}

	/** Hot reload: recompile the program built from `prev` with `next`. If it fails, the old one keeps running. */
	swap(prev: Sources, next: Sources) {
		const program = this.programs.get(keyOf(prev));
		if (!program) return;
		const info = this.compile(next);
		if (!info) return;
		this.gl.deleteProgram(program.info.program);
		program.info = info;
		this.programs.delete(keyOf(prev));
		this.programs.set(keyOf(next), program);
	}

	/** After a context loss: the GL objects are already gone, just forget them. */
	release() {
		this.programs.clear();
		liveCaches.delete(this);
	}

	destroy() {
		for (const program of this.programs.values()) this.gl.deleteProgram(program.info.program);
		this.release();
	}

	private compile(sources: Sources): ProgramInfo | null {
		// twgl returns null on failure (despite its typings) and passes the annotated source to the callback
		const info = createProgramInfo(this.gl, sources, (message: string) => console.error(message)) as ProgramInfo | null;
		if (info) this.compiles++;
		return info;
	}
}

const keyOf = ([vertex, fragment]: Sources) => `${vertex}\0${fragment}`;

/**
 * Called from a drawable module's `import.meta.hot.accept` when its shader files change:
 * every program built from `prev` is recompiled with `next`, without touching the GL context.
 */
export function hotSwap(prev: Sources, next: Sources) {
	for (const cache of liveCaches) cache.swap(prev, next);
}
