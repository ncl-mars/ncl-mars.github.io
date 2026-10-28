<script lang="ts">
	// The find: a project image in full colour, over everything. Opened by clicking a core layer.
	// Escape, the × or a click outside the image closes it; ← / → go to the previous / next image.
	import type { Picture } from 'vite-imagetools';

	let {
		images,
		index = $bindable(),
		onclose
	}: { images: { picture: Picture; caption: string }[]; index: number; onclose: () => void } = $props();

	let closeButton: HTMLButtonElement;
	const current = $derived(images[index]);

	$effect(() => {
		closeButton.focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onclose();
			else if (event.key === 'ArrowRight') index = (index + 1) % images.length;
			else if (event.key === 'ArrowLeft') index = (index - 1 + images.length) % images.length;
			else return;
			event.preventDefault();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});
</script>

<div class="lightbox" role="dialog" aria-modal="true" aria-label={current.caption}>
	<button class="backdrop" tabindex="-1" aria-label="Close" onclick={onclose}></button>
	<figure>
		<enhanced:img src={current.picture} alt={current.caption} sizes="min(92vw, 1200px)" />
		<figcaption>{index + 1} / {images.length} · {current.caption}</figcaption>
	</figure>
	<button class="close" bind:this={closeButton} aria-label="Close" onclick={onclose}>×</button>
</div>

<style>
	.lightbox {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: grid;
		place-items: center;
	}

	.backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		background: rgb(12 14 17 / 0.88);
		cursor: zoom-out;
	}

	figure {
		position: relative;
		margin: 0;
		pointer-events: none;
	}

	figure :global(img) {
		display: block;
		max-width: 92vw;
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

	.close {
		position: absolute;
		top: 1rem;
		right: 1.25rem;
		width: 2.5rem;
		height: 2.5rem;
		border: 0;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.1);
		color: white;
		font-size: 1.5rem;
		line-height: 1;
		cursor: pointer;
	}

	.close:hover {
		background: rgb(255 255 255 / 0.2);
	}
</style>
