<script lang="ts">
	// Legend lines over a GL view: put it inside the view element (it fills it). The layout and animation
	// live in lib/legend/legend.ts, which writes the DOM directly after each rendered frame; this component
	// only renders the elements and keeps the style values (ink, text size, stroke) in step with the panel.
	// With `onselect`, titles are buttons (keyboard and screen readers included); `current` marks one.
	// With `ondata`, the label at `dataAt` gets a Data button under its coordinates.
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { getRenderer } from '$lib/gl/context';
	import { Legend, type LegendElements, type LegendItem } from '$lib/legend/legend';
	import { onTuningChange, readouts, tuning } from '$lib/tuning';
	import type { SurveyCamera } from '$lib/gl/camera';
	import type { Ground } from '$lib/terrain/ground';

	let {
		items,
		camera,
		ground,
		current = -1,
		dataAt = -1,
		onselect,
		ondata
	}: {
		items: LegendItem[];
		camera: SurveyCamera;
		ground: () => Ground | null;
		current?: number;
		dataAt?: number;
		onselect?: (index: number) => void;
		ondata?: (index: number) => void;
	} = $props();

	const renderer = getRenderer();

	let root: HTMLElement;
	// $state only so `bind:this={…[i]}` binds to reactive properties (Svelte warns otherwise); the elements
	// themselves stay plain (Svelte doesn't proxy DOM nodes) and are read once, on mount
	const groups = $state<SVGGElement[]>([]);
	const lines = $state<SVGPolylineElement[]>([]);
	const dots = $state<SVGCircleElement[]>([]);
	const labels = $state<HTMLElement[]>([]);
	const titles = $state<HTMLElement[]>([]);
	const metas = $state<HTMLElement[]>([]);

	onMount(() => {
		const elements: LegendElements[] = items.map((_, i) => ({
			group: groups[i],
			line: lines[i],
			dot: dots[i],
			label: labels[i],
			title: titles[i],
			meta: metas[i]
		}));
		const legend = new Legend(root, items, elements, camera, ground, tuning.legend, tuning.fog, tuning.mist);
		// The text size comes from the legend (smaller on phones), so its lines and the CSS agree
		const applyStyle = () => {
			const s = tuning.legend;
			root.style.setProperty('--ink', `rgb(${s.ink.map((v) => Math.round(v * 255)).join(' ')})`);
			root.style.setProperty('--legend-size', `${legend.textScale()}rem`);
			root.style.setProperty('--stroke', `${s.stroke}px`);
		};
		legend.onScaleChange = applyStyle;
		applyStyle();
		const stopFrames = renderer.onFrame(legend.update);
		const stopTuning = onTuningChange((group) => group === 'legend' && applyStyle());
		readouts.set('legend', () => `legend ${legend.shown}/${items.length} shown`);
		return () => {
			stopFrames();
			stopTuning();
			readouts.delete('legend');
			legend.dispose();
		};
	});
</script>

<div class="legend" bind:this={root}>
	<svg class="lines" aria-hidden="true">
		{#each items as item, i (item)}
			<g bind:this={groups[i]} style="visibility: hidden">
				<polyline bind:this={lines[i]} />
				<circle bind:this={dots[i]} r="0" />
			</g>
		{/each}
	</svg>
	{#each items as item, i (item)}
		<div class="label" class:current={i === current} bind:this={labels[i]} style="visibility: hidden">
			{#if onselect}
				<button
					type="button"
					class="title interactive"
					aria-current={i === current ? 'location' : undefined}
					bind:this={titles[i]}
					onclick={() => onselect(i)}
				>
					{item.title}
				</button>
			{:else}
				<span class="title" bind:this={titles[i]}>{item.title}</span>
			{/if}
			<!-- Under the shelf: the coordinates, then the Data button -->
			<div class="below">
				<span class="meta" bind:this={metas[i]}>{item.meta ?? ''}</span>
				{#if ondata && i === dataAt}
					<button type="button" class="data interactive" onclick={() => ondata(i)} transition:fade={{ duration: 250 }}>
						Data
					</button>
				{/if}
			</div>
		</div>
	{/each}
</div>

<style>
	.legend {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
		color: var(--ink, var(--fg));
		font-size: var(--legend-size, 1rem);
		--stroke: 1px;
	}

	.lines {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
	}

	polyline,
	circle {
		fill: none;
		stroke: currentColor;
		stroke-width: var(--stroke);
	}

	polyline {
		stroke-linejoin: miter;
	}

	/* Zero-size, placed at the start of the shelf: the title stands on the line, the rest hangs under it */
	.label {
		position: absolute;
		top: 0;
		left: 0;
		--text: 0;
	}

	.interactive {
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: inherit;
		cursor: pointer;
		pointer-events: auto;
	}

	.interactive:focus {
		outline: none;
	}

	.interactive:focus-visible {
		outline: 1px solid currentColor;
		outline-offset: 0.25em;
	}

	.title.interactive:hover ~ .below .meta {
		opacity: 1;
	}

	.current .title {
		font-weight: 700;
	}

	.title,
	.below {
		position: absolute;
		left: 0;
		white-space: nowrap;
		opacity: var(--text);
		text-shadow: 0 0 0.6em var(--bg);
	}

	/* data-side is written by legend.ts */
	.label:global([data-side='left']) .title,
	.label:global([data-side='left']) .below {
		left: auto;
		right: 0;
		text-align: right;
	}

	.label:global([data-side='left']) .below {
		align-items: flex-end;
	}

	.title {
		bottom: 0;
		padding-bottom: 0.45em;
		font-weight: 500;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		line-height: 1.2;
		transform: translateY(calc((1 - var(--text)) * 0.35em));
	}

	.below {
		top: var(--stroke);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.6em;
		padding-top: 0.5em;
		transform: translateY(calc((var(--text) - 1) * 0.35em));
	}

	.meta {
		font-family: var(--font-mono);
		font-size: 0.9em;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04em;
		line-height: 1.2;
		opacity: 0.8;
	}

	.data {
		padding: 0.3em 0.75em 0.25em;
		border: var(--stroke) solid currentColor;
		font-family: var(--font-mono);
		font-size: 0.78em;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		line-height: 1.2;
		text-shadow: none;
		transition:
			background-color 0.15s,
			color 0.15s;
	}

	.data:hover,
	.data:focus-visible {
		background: var(--ink, var(--fg));
		color: var(--bg);
	}
</style>
