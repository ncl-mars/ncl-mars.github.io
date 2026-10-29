<script lang="ts">
	// A project's images full screen, as a carousel over everything (the project overlay opens it). Arrows
	// (buttons or ← / →) and horizontal swipes move between images, wrapping around; Escape, the × or a
	// click outside the image closes. `index` is bindable.
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { Picture } from 'vite-imagetools';

	let {
		images,
		index = $bindable(),
		onclose
	}: { images: { picture: Picture; caption: string }[]; index: number; onclose: () => void } = $props();

	let closeButton: HTMLButtonElement;
	let direction = $state(1);
	let swipe: { x: number; y: number } | null = null;
	let swiped = false;
	const current = $derived(images[index]);
	const several = $derived(images.length > 1);
	const reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const slide = reducedMotion ? 0 : 1;

	function go(step: number) {
		if (!several) return;
		direction = step;
		index = (index + step + images.length) % images.length;
	}

	function close() {
		if (swiped) {
			swiped = false; // the click that ends a swipe doesn't close
			return;
		}
		onclose();
	}

	function onPointerDown(event: PointerEvent) {
		swipe = { x: event.clientX, y: event.clientY };
		swiped = false;
	}

	function onPointerUp(event: PointerEvent) {
		if (!swipe) return;
		const dx = event.clientX - swipe.x;
		const dy = event.clientY - swipe.y;
		swipe = null;
		if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
			swiped = true;
			go(dx < 0 ? 1 : -1);
		}
	}

	$effect(() => {
		closeButton.focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onclose();
			else if (event.key === 'ArrowRight') go(1);
			else if (event.key === 'ArrowLeft') go(-1);
			else return;
			event.preventDefault();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});
</script>

<div
	class="lightbox"
	role="dialog"
	aria-modal="true"
	aria-label={current.caption}
	tabindex="-1"
	onpointerdown={onPointerDown}
	onpointerup={onPointerUp}
>
	<button class="backdrop" tabindex="-1" aria-label="Close" onclick={close}></button>

	<div class="stage">
		{#key index}
			<figure
				in:fly={{ x: 90 * direction * slide, duration: 320 * slide, easing: cubicOut }}
				out:fly={{ x: -90 * direction * slide, duration: 220 * slide, easing: cubicOut }}
			>
				<enhanced:img src={current.picture} alt={current.caption} sizes="min(92vw, 1200px)" />
				<figcaption>{index + 1} / {images.length} · {current.caption}</figcaption>
			</figure>
		{/key}
	</div>

	{#if several}
		<button class="arrow previous" aria-label="Previous image" onclick={() => go(-1)}>‹</button>
		<button class="arrow next" aria-label="Next image" onclick={() => go(1)}>›</button>
	{/if}
	<button class="close" bind:this={closeButton} aria-label="Close" onclick={onclose}>×</button>
</div>

<style>
	.lightbox {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: grid;
		place-items: center;
		touch-action: pan-y;
	}

	.backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		background: rgb(12 14 17 / 0.88);
		cursor: zoom-out;
	}

	/* Positioned so it paints above the (positioned) backdrop. Both images share one cell during the slide,
	   so the layout doesn't jump. Clicks on the image don't close; clicks around it reach the backdrop. */
	.stage {
		position: relative;
		display: grid;
		place-items: center;
		pointer-events: none;
	}

	figure {
		grid-area: 1 / 1;
		margin: 0;
		pointer-events: auto;
	}

	figure :global(img) {
		display: block;
		max-width: 84vw;
		max-height: 84vh;
		width: auto;
		height: auto;
		box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 0.5);
	}

	figcaption {
		margin-top: 0.75rem;
		color: rgb(255 255 255 / 0.75);
		font-size: 0.9rem;
		text-align: center;
	}

	.arrow,
	.close {
		position: absolute;
		border: 0;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.1);
		color: white;
		line-height: 1;
		cursor: pointer;
	}

	.arrow:hover,
	.close:hover {
		background: rgb(255 255 255 / 0.22);
	}

	.arrow:focus-visible,
	.close:focus-visible {
		outline: 2px solid rgb(255 255 255 / 0.8);
		outline-offset: 2px;
	}

	.arrow {
		top: 50%;
		width: 3rem;
		height: 3rem;
		font-size: 2rem;
		transform: translateY(-50%);
	}

	.previous {
		left: 1.25rem;
	}

	.next {
		right: 1.25rem;
	}

	.close {
		top: 1rem;
		right: 1.25rem;
		width: 2.5rem;
		height: 2.5rem;
		font-size: 1.5rem;
	}

	@media (max-width: 600px) {
		.arrow {
			top: auto;
			bottom: 1rem;
			transform: none;
		}
	}
</style>
