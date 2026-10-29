<script lang="ts">
	// A project over the scene. Everything behind it (scene, labels, compass) is blurred, desaturated and
	// washed by a CSS backdrop-filter; the panel scrolls on its own, never the window (the views' cached
	// rects stay valid). Escape, the × or a click on the scene closes; images open in the lightbox; videos
	// play muted and looping while visible (not with reduced motion), with controls to unmute.
	// The look comes from tuning.overlay, live; the prerendered page has the defaults.
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { Attachment } from 'svelte/attachments';
	import Lightbox from './Lightbox.svelte';
	import { onTuningChange, tuning } from '$lib/tuning';
	import type { Project } from '$lib/content/projects';

	let { project, kicker, onclose }: { project: Project; kicker?: string; onclose: () => void } = $props();

	const reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	// `tuning` isn't reactive: panel edits bump this, so the style follows
	let tuningRevision = $state(0);
	const style = $derived.by(() => {
		void tuningRevision;
		const o = tuning.overlay;
		const rgb = (c: number[], alpha: number) => `rgb(${c.map((v) => Math.round(v * 255)).join(' ')} / ${alpha})`;
		return [
			`--scene-filter: blur(${o.blur}px) saturate(${o.saturation}) brightness(${o.brightness})`,
			`--tint: ${rgb(o.tint, o.tintOpacity)}`,
			`--panel: ${rgb(o.panelColor, o.panelOpacity)}`,
			`--panel-width: ${o.width}rem`
		].join('; ');
	});
	const fadeIn = () => tuning.overlay.fadeTime * 1000;
	const fadeOut = () => fadeIn() / 1.5;
	const slide = reducedMotion ? 0 : 40;

	const images = $derived(
		project.media.flatMap((item) => (item.kind === 'image' ? [{ picture: item.picture, caption: item.alt }] : []))
	);
	let lightboxOpen = $state(false);
	let lightboxIndex = $state(0);
	let panel: HTMLElement;

	function openImage(mediaIndex: number) {
		lightboxIndex = project.media.slice(0, mediaIndex).filter((item) => item.kind === 'image').length;
		lightboxOpen = true;
	}

	/** Plays while at least half visible (muted, so browsers allow it), pauses otherwise. */
	const playWhenVisible: Attachment<HTMLVideoElement> = (video) => {
		if (reducedMotion) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) video.play().catch(() => {}); // refused (data saver…): the controls remain
				else video.pause();
			},
			{ threshold: 0.5 }
		);
		observer.observe(video);
		return () => observer.disconnect();
	};

	$effect(() => {
		// Keyboard scrolling (arrows, Page Down, Space) goes to the panel
		panel.focus({ preventScroll: true });
		const stopTuning = onTuningChange((group) => group === 'overlay' && tuningRevision++);
		// Registered before the lightbox's own listener, so with the lightbox open Escape only closes that
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || lightboxOpen) return;
			event.preventDefault();
			onclose();
		};
		window.addEventListener('keydown', onKey);
		return () => {
			stopTuning();
			window.removeEventListener('keydown', onKey);
		};
	});
</script>

<div class="overlay" {style} role="dialog" aria-modal="true" aria-labelledby="project-title">
	<button
		class="scene"
		type="button"
		tabindex="-1"
		aria-label="Close the project"
		onclick={onclose}
		in:fade={{ duration: fadeIn() }}
		out:fade={{ duration: fadeOut() }}
	></button>

	<article
		class="panel"
		tabindex="-1"
		bind:this={panel}
		in:fly={{ x: slide, duration: fadeIn(), easing: cubicOut }}
		out:fly={{ x: slide, duration: fadeOut(), easing: cubicOut }}
	>
		<button class="close" type="button" aria-label="Close the project" onclick={onclose}>×</button>
		<header>
			{#if kicker}<p class="kicker">{kicker}</p>{/if}
			<h1 id="project-title">{project.title}</h1>
		</header>

		{#each project.presentation as paragraph, i (i)}
			<p class="presentation">{paragraph}</p>
		{/each}

		{#if project.credits.length}
			<dl class="credits">
				{#each project.credits as credit, i (i)}
					<div>
						<dt>{credit.role}</dt>
						<dd>{credit.names}</dd>
					</div>
				{/each}
			</dl>
		{/if}

		<div class="media">
			{#each project.media as item, i (i)}
				{#if item.kind === 'image'}
					<button class="image" type="button" aria-label="Full screen: {item.alt}" onclick={() => openImage(i)}>
						<enhanced:img src={item.picture} alt={item.alt} sizes="(max-width: 700px) 100vw, {tuning.overlay.width}rem" />
					</button>
				{:else}
					<video
						src={item.src}
						poster={item.poster}
						aria-label={item.alt}
						muted
						loop
						playsinline
						controls
						preload="metadata"
						{@attach playWhenVisible}
					></video>
				{/if}
			{/each}
		</div>
	</article>
</div>

{#if lightboxOpen}
	<Lightbox {images} bind:index={lightboxIndex} onclose={() => (lightboxOpen = false)} />
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 50;
	}

	/* The scene behind, filtered; a click on it closes */
	.scene {
		position: absolute;
		inset: 0;
		padding: 0;
		border: 0;
		background: var(--tint);
		-webkit-backdrop-filter: var(--scene-filter);
		backdrop-filter: var(--scene-filter);
		cursor: pointer;
	}

	.panel {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		box-sizing: border-box;
		width: min(var(--panel-width), 100%);
		padding: 2.75rem 2.5rem 4rem;
		overflow-y: auto;
		overscroll-behavior: contain;
		background: var(--panel);
		color: var(--fg);
		scrollbar-width: thin;
		scrollbar-color: rgb(0 0 0 / 0.25) transparent;
	}

	.panel:focus {
		outline: none;
	}

	/* Floats in the corner and stays there while the panel scrolls */
	.close {
		position: sticky;
		top: 0;
		float: right;
		width: 2.25rem;
		height: 2.25rem;
		margin: -1.25rem -1.25rem 0 1rem;
		padding: 0;
		border: 1px solid rgb(0 0 0 / 0.2);
		border-radius: 50%;
		background: var(--panel);
		color: inherit;
		font-size: 1.35rem;
		line-height: 1;
		cursor: pointer;
	}

	.close:hover {
		border-color: currentColor;
	}

	.close:focus-visible,
	.image:focus-visible {
		outline: 1px solid currentColor;
		outline-offset: 3px;
	}

	.kicker {
		margin: 0 0 0.6rem;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.06em;
		color: var(--muted);
	}

	h1 {
		margin: 0 0 1.5rem;
		font-size: 1.45rem;
		font-weight: 600;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		line-height: 1.25;
	}

	.presentation {
		max-width: 38rem;
		margin: 0 0 0.9rem;
		line-height: 1.6;
	}

	.credits {
		display: grid;
		gap: 0.35rem;
		margin: 1.75rem 0 0;
		padding-top: 1rem;
		border-top: 1px solid rgb(0 0 0 / 0.18);
		font-size: 0.85rem;
	}

	.credits div {
		display: grid;
		grid-template-columns: minmax(7rem, 35%) 1fr;
		gap: 1rem;
	}

	.credits dt {
		font-family: var(--font-mono);
		font-size: 0.92em;
		letter-spacing: 0.04em;
		color: var(--muted);
	}

	.credits dd {
		margin: 0;
	}

	.media {
		display: grid;
		gap: 1.25rem;
		margin-top: 2.5rem;
	}

	.image {
		display: block;
		padding: 0;
		border: 0;
		background: none;
		cursor: zoom-in;
	}

	.image :global(img),
	video {
		display: block;
		max-width: 100%;
		max-height: 80vh;
		width: auto;
		height: auto;
		margin-inline: auto;
	}

	video {
		width: 100%;
		background: rgb(0 0 0 / 0.08);
	}

	@media (max-width: 700px) {
		.panel {
			width: 100%;
			padding: 2.5rem 1.25rem 3rem;
		}

		.close {
			margin-right: -0.25rem;
		}
	}
</style>
