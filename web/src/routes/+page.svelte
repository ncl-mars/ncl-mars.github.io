<script module lang="ts">
	import { SurveyCamera } from '$lib/gl/camera';
	import { Terrain } from '$lib/drawables/terrain/Terrain';
	import { terrainAssets } from '$lib/terrain/assets';

	// Module level: the camera (and where you were on the site) survives navigating away and back
	const camera = new SurveyCamera({ pitchNear: 25, pitchFar: 60, fov: 35, distance: 350 });
	const terrain = new Terrain(camera, terrainAssets);
</script>

<script lang="ts">
	// Home: the dig site. One full-viewport view drawn by the terrain raymarcher, with pan + zoom.
	// Perf tuning from the URL: ?steps=48 (march steps), ?dpr=1 (pixel-ratio cap).
	import { onMount } from 'svelte';
	import { getRenderer } from '$lib/gl/context';
	import { surveyControls } from '$lib/gl/controls';

	const renderer = getRenderer();

	onMount(() => {
		const params = new URLSearchParams(location.search);
		const steps = Number(params.get('steps'));
		if (steps > 0) terrain.steps = steps;
		const dpr = Number(params.get('dpr'));
		if (!(dpr > 0)) return;
		const previous = renderer.setMaxPixelRatio(dpr);
		return () => renderer.setMaxPixelRatio(previous);
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
	aria-label="Dig site. Drag to pan, scroll or pinch to zoom, arrow keys to move, plus and minus to zoom."
	tabindex="0"
	{@attach renderer.view(terrain)}
	{@attach surveyControls(camera, { field: () => terrain.field })}
></div>

<header class="overlay">
	<h1>Portfolio</h1>
	<a href="/lab/views/">lab</a>
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

	.site:focus {
		outline: none;
	}

	.site:focus-visible {
		outline: 2px solid rgb(255 255 255 / 0.6);
		outline-offset: -2px;
	}

	.overlay {
		position: fixed;
		top: 0;
		left: 0;
		padding: 1.25rem 1.5rem;
		color: #1d1f21;
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
