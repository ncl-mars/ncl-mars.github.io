<script lang="ts">
	// Dev-only panel: renderer stats, live read-outs (e.g. camera pitch), buttons registered by pages
	// (`actions`, e.g. Copy pose) and live tuning of every value in
	// src/lib/tuning/defaults.json, laid out by schema.ts. Edits apply immediately: the code reads `tuning`
	// every frame. "Save defaults" writes defaults.json through the dev server (vite.config.ts,
	// /__tuning/save) without reloading the app; "Copy" puts the JSON on the clipboard; "Reset" goes back
	// to the saved values. The dot before a label marks a changed value (click it to reset that one).
	// The root layout loads this with a dynamic import behind import.meta.env.DEV: not in production builds.
	// Toggle with P, or the × / "dev" tab in its corner (phones have no P). Shown or hidden is remembered.
	import type { Renderer, RendererStats } from '$lib/gl/renderer';
	import { schema, type Param } from '$lib/tuning/schema';
	import { actions, onTuningChange, readouts, savedDefaults, setTuning, tuning, type TuningValue } from '$lib/tuning';
	import { formatTuning } from '$lib/tuning/format';

	type Values = Record<string, Record<string, TuningValue>>;

	let { renderer }: { renderer: Renderer } = $props();

	// Panel layout state (shown, controls shown, which groups are collapsed), remembered in this browser
	const UI_KEY = 'dev-panel-ui';
	const storedUi = (() => {
		try {
			return JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') as {
				open?: boolean;
				controlsOpen?: boolean;
				collapsed?: Record<string, boolean>;
			};
		} catch {
			return {};
		}
	})();

	let stats = $state<RendererStats | null>(null);
	let lines = $state<string[]>([]);
	let actionNames = $state<string[]>([]);
	let actionStatus = $state('');
	let open = $state(storedUi.open ?? true);
	let controlsOpen = $state(storedUi.controlsOpen ?? true);
	let collapsed = $state<Record<string, boolean>>(storedUi.collapsed ?? {});
	let values = $state<Values>(structuredClone(tuning) as unknown as Values);
	let saved = $state<Values>(structuredClone(savedDefaults()) as unknown as Values);
	let status = $state('');
	let fontSize = $state(12);

	/**
	 * Panel size from the screen's resolution, not the window: about 1/148 of the screen height in CSS px
	 * (≈10.8px on a 1600 px tall screen, the 10px minimum below 1480), so resizing the window doesn't change
	 * it. Browser zoom still scales it like any page text. Everything else in the panel is in em.
	 */
	const panelFontSize = () => Math.min(22, Math.max(10, Math.round((screen.height / 148) * 10) / 10));

	$effect(() => {
		const ui = JSON.stringify({ open, controlsOpen, collapsed });
		try {
			localStorage.setItem(UI_KEY, ui);
		} catch {
			// storage unavailable (private mode…): the panel just won't remember its layout
		}
	});

	$effect(() => {
		// Values changed elsewhere (defaults.json reloaded): mirror them in the inputs
		const stopListening = onTuningChange((group, key) => {
			const live = (tuning as unknown as Values)[group]?.[key];
			if (live !== undefined && values[group]) values[group][key] = structuredClone(live);
		});
		let savedRef = savedDefaults();
		const poll = () => {
			stats = renderer.readStats();
			lines = [...readouts.values()].map((read) => read());
			const names = [...actions.keys()];
			if (names.join('\n') !== actionNames.join('\n')) actionNames = names;
			fontSize = panelFontSize(); // follows the window to another screen
			if (savedDefaults() !== savedRef) {
				savedRef = savedDefaults();
				saved = structuredClone(savedRef) as unknown as Values;
			}
		};
		poll();
		const interval = setInterval(poll, 250);
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (target?.closest('input, textarea, select, [contenteditable]')) return;
			if (event.key === 'p' || event.key === 'P') open = !open;
		};
		window.addEventListener('keydown', onKey);
		for (const group of schema) {
			for (const param of group.params) {
				if (values[group.key]?.[param.key] === undefined) {
					console.warn(`[dev panel] schema.ts: ${group.key}.${param.key} is not in defaults.json`);
				}
			}
		}
		return () => {
			stopListening();
			clearInterval(interval);
			window.removeEventListener('keydown', onKey);
		};
	});

	function set(group: string, key: string, value: TuningValue) {
		values[group][key] = value;
		setTuning(group, key, Array.isArray(value) ? [...value] : value);
	}

	function decimals(step = 1) {
		return step.toString().split('.')[1]?.length ?? 0;
	}

	function snap(value: number, param: Param) {
		const v = Number(value.toFixed(decimals(param.step)));
		return param.kind === 'int' ? Math.round(v) : v;
	}

	function same(a: TuningValue, b: TuningValue) {
		return Array.isArray(a) ? Array.isArray(b) && a.every((v, i) => v === b[i]) : a === b;
	}

	const toHex = (color: number[]) =>
		'#' + color.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
	const fromHex = (hex: string) => [1, 3, 5].map((i) => Number((parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)));

	async function save() {
		status = 'saving…';
		try {
			const response = await fetch('/__tuning/save', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify($state.snapshot(values))
			});
			if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
			saved = $state.snapshot(values);
			status = 'saved to defaults.json';
		} catch (error) {
			status = `save failed: ${error instanceof Error ? error.message : error}`;
		}
	}

	async function copy() {
		await navigator.clipboard.writeText(formatTuning($state.snapshot(values)));
		status = 'JSON copied';
	}

	async function runAction(name: string) {
		try {
			actionStatus = (await actions.get(name)?.()) ?? '';
		} catch (error) {
			actionStatus = `${name} failed: ${error instanceof Error ? error.message : error}`;
		}
	}

	function resetAll() {
		for (const group of schema) {
			for (const param of group.params) set(group.key, param.key, $state.snapshot(saved[group.key][param.key]));
		}
		status = 'reset to saved defaults';
	}
</script>

{#if open}
	<aside class="panel" style:font-size="{fontSize}px">
		<button class="hide" type="button" title="Hide the panel (P)" aria-label="Hide the dev panel" onclick={() => (open = false)}>
			×
		</button>
		{#if stats}
			<section class="stats">
				<div>ctx #{stats.contextId} · {stats.running ? 'running' : 'idle'}</div>
				<div>{stats.running ? stats.fps.toFixed(0) : '–'} fps · {stats.frameMs.toFixed(2)} ms cpu</div>
				<div>views {stats.visibleViews}/{stats.views} · programs {stats.programs} · compiles {stats.compiles}</div>
				<div>{stats.width}×{stats.height} @{stats.pixelRatio.toFixed(2)} · q {stats.quality.toFixed(2)}</div>
				{#each lines as line, i (i)}
					<div class="readout">{line}</div>
				{/each}
			</section>
		{/if}

		{#if actionNames.length}
			<section class="actions">
				<div class="buttons">
					{#each actionNames as name (name)}
						<button onclick={() => runAction(name)}>{name}</button>
					{/each}
				</div>
				{#if actionStatus}<div class="status">{actionStatus}</div>{/if}
			</section>
		{/if}

		<button
			class="panel-title"
			aria-expanded={controlsOpen}
			title={controlsOpen ? 'Hide the settings' : 'Show the settings'}
			onclick={() => (controlsOpen = !controlsOpen)}
		>
			{controlsOpen ? '▾' : '▸'} Settings
		</button>

		{#if controlsOpen}
		{#each schema as group (group.key)}
			<section class="group">
				<button class="group-title" onclick={() => (collapsed[group.key] = !collapsed[group.key])}>
					{collapsed[group.key] ? '▸' : '▾'} {group.label}
				</button>
				{#if !collapsed[group.key] && values[group.key]}
					{#each group.params as param (param.key)}
						{@const value = values[group.key][param.key]}
						{@const changed = !same(value, saved[group.key]?.[param.key])}
						<div class="row" title={param.hint ?? ''}>
							<button
								class="dot"
								class:changed
								disabled={!changed}
								title="Reset to the saved value"
								aria-label="Reset {param.label}"
								onclick={() => set(group.key, param.key, $state.snapshot(saved[group.key][param.key]))}
							></button>
							<span class="label">{param.label}</span>
							{#if param.kind === 'color'}
								<input
									class="color"
									type="color"
									value={toHex(value as number[])}
									oninput={(e) => set(group.key, param.key, fromHex(e.currentTarget.value))}
								/>
							{:else}
								<input
									class="range"
									type="range"
									min={param.min}
									max={param.max}
									step={param.step}
									value={value as number}
									oninput={(e) => set(group.key, param.key, snap(e.currentTarget.valueAsNumber, param))}
								/>
								<input
									class="number"
									type="number"
									step={param.step}
									value={value as number}
									onchange={(e) => {
										const v = e.currentTarget.valueAsNumber;
										if (Number.isFinite(v)) set(group.key, param.key, snap(v, param));
									}}
								/>
							{/if}
						</div>
					{/each}
				{/if}
			</section>
		{/each}

		<footer>
			<div class="buttons">
				<button onclick={save}>Save defaults</button>
				<button onclick={copy}>Copy</button>
				<button onclick={resetAll}>Reset</button>
			</div>
			{#if status}<div class="status">{status}</div>{/if}
			<div class="hint">P hides this panel</div>
		</footer>
		{/if}
	</aside>
{:else}
	<button class="tab" type="button" style:font-size="{fontSize}px" title="Show the dev panel (P)" onclick={() => (open = true)}>
		dev
	</button>
{/if}

<style>
	/* The font size comes from the screen resolution (inline style, see panelFontSize). Every other
	   dimension is in em, so the whole panel scales with it. */
	.panel {
		position: fixed;
		top: 0.7em;
		right: 0.7em;
		z-index: 1000;
		width: 27em;
		max-height: calc(100vh - 1.4em);
		overflow-y: auto;
		padding: 0.55em 0.7em 0.7em;
		border-radius: 0.55em;
		background: rgb(16 17 19 / 0.82);
		color: #d6e4df;
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
		line-height: 1.45;
		backdrop-filter: blur(4px);
	}

	/* In the panel's corner, over the end of the short first stats line */
	.hide {
		position: absolute;
		top: 0.3em;
		right: 0.35em;
		width: 2.2em;
		height: 2.2em;
		padding: 0;
		border: 0;
		border-radius: 0.4em;
		background: none;
		color: #9fc9bb;
		font: inherit;
		font-size: 1.25em;
		line-height: 1;
		cursor: pointer;
	}

	.hide:hover {
		background: rgb(255 255 255 / 0.08);
		color: #e8efe9;
	}

	/* The hidden panel: a small tab in the same corner */
	.tab {
		position: fixed;
		top: 0.7em;
		right: 0.7em;
		z-index: 1000;
		padding: 0.45em 0.8em;
		border: 0;
		border-radius: 0.55em;
		background: rgb(16 17 19 / 0.55);
		color: #d6e4df;
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
		cursor: pointer;
		backdrop-filter: blur(4px);
	}

	.tab:hover {
		background: rgb(16 17 19 / 0.82);
	}

	.panel-title {
		width: 100%;
		padding: 0.5em 0 0.2em;
		border: 0;
		background: none;
		color: #e8efe9;
		font: inherit;
		font-weight: 700;
		text-align: left;
		cursor: pointer;
	}

	.stats {
		padding-bottom: 0.55em;
		border-bottom: 1px solid rgb(255 255 255 / 0.1);
		white-space: nowrap;
	}

	.readout {
		color: #f2c94c;
	}

	.group {
		border-bottom: 1px solid rgb(255 255 255 / 0.08);
	}

	.group-title {
		width: 100%;
		padding: 0.45em 0;
		border: 0;
		background: none;
		color: #9fc9bb;
		font: inherit;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}

	.row {
		display: grid;
		grid-template-columns: 0.9em 9em 1fr 5.3em;
		align-items: center;
		gap: 0.36em;
		padding: 0.1em 0;
	}

	.row:has(.color) {
		grid-template-columns: 0.9em 9em 1fr;
	}

	.label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dot {
		width: 0.64em;
		height: 0.64em;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
	}

	.dot.changed {
		background: #f2994a;
		cursor: pointer;
	}

	.range {
		width: 100%;
		margin: 0;
		accent-color: #6fb8a2;
	}

	.number {
		width: 100%;
		padding: 0.1em 0.27em;
		border: 1px solid rgb(255 255 255 / 0.15);
		border-radius: 0.27em;
		background: rgb(0 0 0 / 0.3);
		color: inherit;
		font: inherit;
	}

	.color {
		width: 100%;
		height: 1.65em;
		padding: 0;
		border: 0;
		background: none;
	}

	footer {
		padding-top: 0.55em;
	}

	.actions {
		padding: 0.55em 0;
		border-bottom: 1px solid rgb(255 255 255 / 0.1);
	}

	.buttons {
		display: flex;
		gap: 0.36em;
	}

	.buttons button {
		flex: 1;
		padding: 0.27em 0;
		border: 1px solid rgb(255 255 255 / 0.2);
		border-radius: 0.27em;
		background: rgb(255 255 255 / 0.06);
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.buttons button:hover {
		background: rgb(255 255 255 / 0.14);
	}

	.status {
		margin-top: 0.36em;
		color: #f2c94c;
	}

	.hint {
		margin-top: 0.36em;
		color: rgb(255 255 255 / 0.4);
	}
</style>
