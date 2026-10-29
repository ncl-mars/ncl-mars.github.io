<script module lang="ts">
	import { SurveyCamera } from '$lib/gl/camera';
	import { Terrain } from '$lib/drawables/terrain/Terrain';
	import { terrainAssets } from '$lib/terrain/assets';
	import { tuning } from '$lib/tuning';

	// Module level: the camera (and where you were on the site) survives navigating away and back.
	// Both read their settings live from `tuning`, which the dev panel edits.
	const camera = new SurveyCamera(tuning.camera, tuning.controls);
	const terrain = new Terrain(camera, terrainAssets, tuning);
</script>

<script lang="ts">
	// Home: the dig site. One full-viewport view drawn by the terrain raymarcher, with pan + zoom.
	// Perf tuning from the URL: ?steps=48 (march iteration cap), ?dpr=1 (pixel-ratio cap).
	import { onMount } from 'svelte';
	import { getRenderer } from '$lib/gl/context';
	import { surveyControls } from '$lib/gl/controls';
	import { onTuningChange, readouts } from '$lib/tuning';

	const renderer = getRenderer();

	let site: HTMLElement;
	let needle: SVGGElement;

	onMount(() => {
		// Keyboard controls work right away, without a focus ring nobody asked for
		site.focus({ preventScroll: true, focusVisible: false } as FocusOptions);

		// Compass needle follows the heading: written straight to the DOM after each frame, only on change
		let shownYaw = NaN;
		const stopCompass = renderer.onFrame(() => {
			if (camera.yaw === shownYaw) return;
			shownYaw = camera.yaw;
			needle.setAttribute('transform', `rotate(${(camera.yaw * 180) / Math.PI} 16 16)`);
		});

		// Panel edits to the ground itself (not the atmosphere) need a re-march of the terrain cache
		const stopTuning = onTuningChange((group) => {
			if (group === 'march' || group === 'shading' || group === 'farField' || group === 'fog') terrain.invalidate();
		});
		readouts.set('terrain', () => `terrain ${terrain.marchedLastFrame ? 'marching' : 'cached'} · ${terrain.marches} marches`);

		readouts.set('camera', () => {
			const deg = 180 / Math.PI;
			const heading = (((-camera.yaw * deg) % 360) + 360) % 360; // compass: 0 north, 90 east
			return `pitch ${(camera.pitch * deg).toFixed(1)}° · heading ${heading.toFixed(0)}° · distance ${camera.distance.toFixed(0)}`;
		});

		const params = new URLSearchParams(location.search);
		const steps = Number(params.get('steps'));
		if (steps > 0) tuning.march.steps = steps;
		const dpr = Number(params.get('dpr'));
		const previous = dpr > 0 ? renderer.setMaxPixelRatio(dpr) : null;

		return () => {
			stopCompass();
			stopTuning();
			readouts.delete('terrain');
			readouts.delete('camera');
			if (previous !== null) renderer.setMaxPixelRatio(previous);
		};
	});
</script>

<svelte:head>
	<title>Portfolio</title>
</svelte:head>

<!-- Focusable for the keyboard controls, which surveyControls attaches (Svelte can't see them) -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="site"
	role="application"
	aria-label="Dig site. Drag to pan, scroll or pinch to zoom, right-drag or twist to rotate. Keys: arrows to move, Q and E to rotate, N for north, plus and minus to zoom."
	tabindex="0"
	bind:this={site}
	{@attach renderer.view(terrain)}
	{@attach surveyControls(camera, { ground: () => terrain.ground, settings: tuning.controls })}
></div>

<button class="compass" onclick={() => camera.resetNorth()} aria-label="Face north" title="Face north (N)">
	<svg viewBox="0 0 32 32" aria-hidden="true">
		<circle class="ring" cx="16" cy="16" r="14.5" />
		<g bind:this={needle}>
			<path class="north" d="M16 5 L19.5 16 L12.5 16 Z" />
			<path class="south" d="M16 27 L19.5 16 L12.5 16 Z" />
		</g>
	</svg>
</button>

<header class="overlay">
	<h1>Portfolio</h1>
	<a href="/lab/views/">lab: views</a> · <a href="/lab/core/">lab: core</a>
</header>

<style>
	.site {
		height: 100vh;
		height: 100dvh;
		touch-action: none;
		user-select: none;
		cursor: grab;
	}

	.site:global(.grabbing) {
		cursor: grabbing;
	}

	.site:global(.rotating) {
		cursor: ew-resize;
	}

	.site:focus {
		outline: none;
	}

	.site:focus-visible {
		outline: 2px solid rgb(255 255 255 / 0.6);
		outline-offset: -2px;
	}

	.compass {
		position: fixed;
		right: 1.25rem;
		bottom: 1.25rem;
		width: 2.75rem;
		height: 2.75rem;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: rgb(20 21 23 / 0.35);
		backdrop-filter: blur(3px);
		cursor: pointer;
	}

	.compass:hover {
		background: rgb(20 21 23 / 0.55);
	}

	.compass:focus-visible {
		outline: 2px solid rgb(255 255 255 / 0.7);
		outline-offset: 2px;
	}

	.compass svg {
		display: block;
		width: 100%;
		height: 100%;
	}

	.compass .ring {
		fill: none;
		stroke: rgb(255 255 255 / 0.35);
		stroke-width: 1;
	}

	.compass .north {
		fill: #e8875a;
	}

	.compass .south {
		fill: rgb(255 255 255 / 0.75);
	}

	.overlay {
		position: fixed;
		top: 0;
		left: 0;
		padding: 1.25rem 1.5rem;
		color: var(--fg);
		pointer-events: none;
	}

	.overlay h1 {
		margin: 0 0 0.25rem;
		font-size: 1.1rem;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.overlay a {
		font-size: 0.85rem;
		pointer-events: auto;
	}
</style>
