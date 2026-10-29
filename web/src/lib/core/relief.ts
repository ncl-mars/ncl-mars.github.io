/**
 * Relief maps: one depth map per project image, displacing its stratum in the core viewer
 * (format: doc/formats/relief.md). Row 0 is the top of the image; 1 = closest to the viewer.
 */

export interface ReliefMeta {
	version: 1;
	width: number;
	height: number;
	format: 'r16f';
}

export interface Relief {
	meta: ReliefMeta;
	/** Raw half floats, ready for the R16F texture upload. */
	half: Uint16Array;
}

/** Validate a relief .json; throws with a clear message instead of rendering garbage. */
export function parseReliefMeta(json: unknown, name = 'relief.json'): ReliefMeta {
	const m = json as Partial<ReliefMeta>;
	if (m?.version !== 1) throw new Error(`${name}: unsupported version ${m?.version}`);
	if (m.format !== 'r16f') throw new Error(`${name}: unsupported format ${m.format}`);
	if (!(Number(m.width) > 0 && Number(m.height) > 0)) throw new Error(`${name}: bad width/height`);
	return m as ReliefMeta;
}

const cache = new Map<string, Promise<Relief>>();

/** Fetch a relief map once per URL (pure data: it outlives GL contexts and navigation). */
export function loadRelief(url: string, meta: ReliefMeta): Promise<Relief> {
	let promise = cache.get(url);
	if (!promise) {
		promise = fetch(url)
			.then((response) => {
				if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
				return response.arrayBuffer();
			})
			.then((buffer) => {
				const expected = meta.width * meta.height * 2;
				if (buffer.byteLength !== expected) {
					throw new Error(`${url}: ${buffer.byteLength} bytes, expected ${expected}`);
				}
				return { meta, half: new Uint16Array(buffer) };
			});
		promise.catch(() => cache.delete(url)); // allow a retry
		cache.set(url, promise);
	}
	return promise;
}
