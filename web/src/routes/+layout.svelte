<script lang="ts">
	// Root layout: owns the site's single WebGL2 canvas and its renderer. Living here, they survive
	// client-side navigation (GL context, compiled programs, textures). Pages register views with
	// `getRenderer()` + `{@attach renderer.view(drawable)}` and never create a canvas of their own.
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount, type Component } from 'svelte';
	import { Renderer } from '$lib/gl/renderer';
	import { setRenderer } from '$lib/gl/context';

	let { children } = $props();

	const renderer = new Renderer({ maxPixelRatio: 2 });
	setRenderer(renderer);

	let canvas: HTMLCanvasElement;
	let PerfHud = $state<Component<{ renderer: Renderer }> | null>(null);

	onMount(() => {
		renderer.mount(canvas);
		if (import.meta.env.DEV) {
			import('$lib/components/PerfHud.svelte').then((module) => (PerfHud = module.default));
		}
		return () => renderer.unmount();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<canvas bind:this={canvas} class="gl" aria-hidden="true"></canvas>

{@render children()}

{#if PerfHud}
	<PerfHud {renderer} />
{/if}

<style>
	.gl {
		position: fixed;
		inset: 0;
		z-index: -1;
		display: block;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
</style>
