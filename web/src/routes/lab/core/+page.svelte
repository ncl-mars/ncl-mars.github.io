<script lang="ts">
	// Core viewer prototype (M3a): one placeholder project's core sample in the foreground, its images as
	// relief strata. Scroll digs through the layers; click a layer to see its colour image. Not linked from
	// the site's navigation. The scroll is native (a tall spacer in a fixed scroller); the window itself
	// never scrolls, so the fixed GL view's cached rect stays valid.
	import { onMount } from 'svelte';
	import { getRenderer } from '$lib/gl/context';
	import { CoreViewer } from '$lib/drawables/core/CoreViewer';
	import { quadToMatrix3d } from '$lib/gl/homography';
	import { labProject as project } from '$lib/content/lab-core';
	import { readouts, tuning } from '$lib/tuning';
	import Lightbox from '$lib/components/Lightbox.svelte';

	const HIT_SIZE = 100; // hit areas are 100×100 px boxes mapped onto each layer's quad

	const renderer = getRenderer();
	// Alone on this page (no terrain behind), so the core paints the fog colour behind itself
	const viewer = new CoreViewer(tuning.core, project.images, { backdrop: () => tuning.fog.color });

	let scroller: HTMLElement;
	const hits: HTMLButtonElement[] = [];
	const shownTransforms: string[] = [];
	let focused = $state(0);
	let lightboxOpen = $state(false);
	let lightboxIndex = $state(0);

	function onScroll() {
		const max = scroller.scrollHeight - scroller.clientHeight;
		viewer.targetFocus = max > 0 ? (scroller.scrollTop / max) * (project.images.length - 1) : 0;
	}

	function onPointerMove(event: PointerEvent) {
		viewer.pointer.x = (event.clientX / innerWidth) * 2 - 1;
		viewer.pointer.y = (event.clientY / innerHeight) * 2 - 1;
	}

	function open(i: number) {
		lightboxIndex = i;
		lightboxOpen = true;
	}

	onMount(() => {
		scroller.focus({ preventScroll: true, focusVisible: false } as FocusOptions);

		// Hit areas follow the image on the cut face (perspective included), written after each frame.
		// Only the image showing at the current depth is clickable.
		const stopHits = renderer.onFrame(() => {
			for (let i = 0; i < hits.length; i++) {
				const el = hits[i];
				const quad = viewer.layerQuad(i);
				const transform = quad ? quadToMatrix3d(quad, HIT_SIZE, HIT_SIZE) : 'none';
				if (transform === shownTransforms[i]) continue;
				shownTransforms[i] = transform;
				el.style.transform = transform;
				el.style.visibility = quad ? 'visible' : 'hidden';
			}
			const nearest = Math.round(viewer.focus);
			if (nearest !== focused) focused = nearest;
		});
		readouts.set(
			'core',
			() =>
				`core focus ${viewer.focus.toFixed(2)} / ${project.images.length - 1} · frames ${viewer.stats.frames} · reliefs ${viewer.stats.reliefs}/${project.images.length}`
		);

		return () => {
			stopHits();
			readouts.delete('core');
		};
	});
</script>

<svelte:head>
	<title>Lab · core</title>
</svelte:head>

<div class="view" {@attach renderer.view(viewer)}></div>

<!-- Focusable so the keyboard scrolls it (arrows, Page Up/Down, space) -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="scroller"
	bind:this={scroller}
	onscroll={onScroll}
	onpointermove={onPointerMove}
	tabindex="0"
	role="region"
	aria-label="Project layers. Scroll to dig through them."
	inert={lightboxOpen}
>
	<div class="stage">
		<div class="hits">
			{#each project.images as image, i (i)}
				<button
					class="hit"
					bind:this={hits[i]}
					style:width="{HIT_SIZE}px"
					style:height="{HIT_SIZE}px"
					aria-label="Open image {i + 1}: {image.caption}"
					onclick={() => open(i)}
				></button>
			{/each}
		</div>

		<aside class="text">
			<p class="cell">{project.cell}</p>
			<h1>{project.title}</h1>
			<p>{project.text}</p>
			<p class="caption">{focused + 1} / {project.images.length} · {project.images[focused].caption}</p>
			<p class="hint">Scroll to dig · click the relief to see it</p>
			<p class="back"><a href="/">← Dig site</a></p>
		</aside>
	</div>
	<div class="spacer" style:height="{project.images.length * 60}vh"></div>
</div>

{#if lightboxOpen}
	<Lightbox images={project.images} bind:index={lightboxIndex} onclose={() => (lightboxOpen = false)} />
{/if}

<style>
	.view {
		position: fixed;
		inset: 0;
	}

	.scroller {
		position: fixed;
		inset: 0;
		overflow-y: auto;
		scrollbar-width: thin;
	}

	.scroller:focus {
		outline: none;
	}

	.stage {
		position: sticky;
		top: 0;
		height: 100vh;
		height: 100dvh;
	}

	.hits {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}

	.hit {
		position: absolute;
		top: 0;
		left: 0;
		padding: 0;
		border: 0;
		background: transparent;
		transform-origin: 0 0;
		visibility: hidden;
		pointer-events: auto;
		cursor: zoom-in;
	}

	.hit:focus-visible {
		outline: 2px solid rgb(255 255 255 / 0.8);
		outline-offset: -2px;
	}

	.text {
		position: absolute;
		top: 50%;
		right: 6vw;
		width: min(30rem, 34vw);
		transform: translateY(-50%);
	}

	.cell {
		margin: 0;
		color: var(--muted);
		font-size: 0.85rem;
		letter-spacing: 0.15em;
	}

	h1 {
		margin: 0.25rem 0 1rem;
		font-size: 1.6rem;
		font-weight: 600;
	}

	.caption {
		margin-top: 1.5rem;
		font-size: 0.9rem;
	}

	.hint,
	.back {
		color: var(--muted);
		font-size: 0.8rem;
	}

	@media (max-width: 760px) {
		.text {
			top: auto;
			right: 1.25rem;
			bottom: 1.25rem;
			left: 1.25rem;
			width: auto;
			transform: none;
		}
	}
</style>
