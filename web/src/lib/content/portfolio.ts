import file from '$lib/assets/portfolio.yaml';

/**
 * The portfolio's own text, from lib/assets/portfolio.yaml (format: doc/formats/portfolio.md): your name and
 * the home page's description. Checked here: a mistake stops the page with a message.
 */
export interface Portfolio {
	name: string;
	description: string;
}

export const portfolio: Portfolio = readPortfolio(file);

function readPortfolio(data: unknown): Portfolio {
	const fail = (message: string) => new Error(`portfolio.yaml: ${message}`);
	if (typeof data !== 'object' || data === null || Array.isArray(data)) throw fail('expected "key: value" lines');
	const { name, description = '', ...rest } = data as Record<string, unknown>;
	const unknown = Object.keys(rest)[0];
	if (unknown !== undefined) throw fail(`unknown key "${unknown}" (name, description)`);
	if (typeof name !== 'string' || !name.trim()) throw fail('needs a name (name: …)');
	if (typeof description !== 'string') throw fail('description must be text');
	return { name: name.trim(), description: description.trim() };
}
