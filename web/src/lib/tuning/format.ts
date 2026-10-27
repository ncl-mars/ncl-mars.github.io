/**
 * defaults.json formatting, shared by the dev panel (Copy) and the dev server endpoint (Save), so the file
 * always looks the same: tabs, and number arrays (colours) on one line.
 */
export function formatTuning(data: unknown): string {
	return (
		JSON.stringify(data, null, '\t').replace(
			/\[\s*(-?[\d.eE+-]+(?:,\s*-?[\d.eE+-]+)*)\s*\]/g,
			(_, inner: string) => `[${inner.split(/,\s*/).join(', ')}]`
		) + '\n'
	);
}

/** True when `candidate` has exactly the groups, keys and value types of `reference` (one level deep). */
export function sameShape(reference: unknown, candidate: unknown): boolean {
	if (!isRecord(reference) || !isRecord(candidate)) return false;
	const groups = Object.keys(reference);
	if (groups.length !== Object.keys(candidate).length) return false;
	return groups.every((group) => {
		const a = reference[group];
		const b = candidate[group];
		if (!isRecord(a) || !isRecord(b)) return false;
		const keys = Object.keys(a);
		if (keys.length !== Object.keys(b).length) return false;
		return keys.every((key) =>
			Array.isArray(a[key])
				? Array.isArray(b[key]) &&
					(b[key] as unknown[]).length === (a[key] as unknown[]).length &&
					(b[key] as unknown[]).every((v) => typeof v === 'number' && Number.isFinite(v))
				: typeof b[key] === 'number' && Number.isFinite(b[key])
		);
	});
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
