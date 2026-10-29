<script lang="ts">
	// Legend lines over a GL view: put it inside the view element (it fills it). The layout and animation
	// live in lib/legend/legend.ts, which writes the DOM directly after each rendered frame; this component
	// only renders the elements and keeps the style values (ink, text size, stroke) in step with the panel.
	import { onMount } from 'svelte';
	import { getRenderer } from '$lib/gl/context';
	import { Legend, type LegendElements, type LegendItem } from '$lib/legend/legend';
	import { onTuningChange, readouts, tuning } from '$lib/tuning';
	import type { SurveyCamera } from '$lib/gl/camera';
	import type { Ground } from '$lib/terrain/ground';

	let { items, camera, ground }: { items: LegendItem[]; camera: SurveyCamera; ground: () => Ground | null } =
		$props();

	const renderer = getRenderer();

	let root: HTMLElement;
	const groups: SVGGElement[] = [];
	const lines: SVGPolylineElement[] = [];
	const dots: SVGCircleElement[] = [];
	const labels: HTMLElement[] = [];
	const titles: HTMLElement[] = [];
	const metas: HTMLElement[] = [];

	function applyStyle() {
		const s = tuning.legend;
		root.style.setProperty('--ink', `rgb(${s.ink.map((v) => Math.round(v * 255)).join(' ')})`);
		root.style.setProperty('--legend-size', `${s.scale}rem`);
		root.style.setProperty('--stroke', `${s.stroke}px`);
	}

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
		<div class="label" bind:this={labels[i]} style="visibility: hidden">
			<span class="title" bind:this={titles[i]}>{item.title}</span>
			<span class="meta" bind:this={metas[i]}>{item.meta ?? ''}</span>
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

	/* Zero-size, placed at the start of the shelf: the title stands on the line, the meta hangs under it */
	.label {
		position: absolute;
		top: 0;
		left: 0;
		--text: 0;
	}

	.title,
	.meta {
		position: absolute;
		left: 0;
		white-space: nowrap;
		opacity: var(--text);
		text-shadow: 0 0 0.6em var(--bg);
	}

	.label:global(.left) .title,
	.label:global(.left) .meta {
		left: auto;
		right: 0;
		text-align: right;
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

	.meta {
		top: var(--stroke);
		padding-top: 0.5em;
		font-family: var(--font-mono);
		font-size: 0.9em;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04em;
		line-height: 1.2;
		opacity: calc(var(--text) * 0.8);
		transform: translateY(calc((var(--text) - 1) * 0.35em));
	}
</style>
