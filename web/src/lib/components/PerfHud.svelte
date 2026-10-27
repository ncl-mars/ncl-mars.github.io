<script lang="ts">
	// Dev-only overlay with the renderer's stats. The root layout loads it with a dynamic import behind
	// `import.meta.env.DEV`, so it's not in production builds. Toggle with the P key.
	import type { Renderer, RendererStats } from '$lib/gl/renderer';

	let { renderer }: { renderer: Renderer } = $props();

	let stats = $state<RendererStats | null>(null);
	let open = $state(true);

	$effect(() => {
		const poll = () => (stats = renderer.readStats());
		poll();
		const interval = setInterval(poll, 250);
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (target?.closest('input, textarea, [contenteditable]')) return;
			if (event.key === 'p' || event.key === 'P') open = !open;
		};
		window.addEventListener('keydown', onKey);
		return () => {
			clearInterval(interval);
			window.removeEventListener('keydown', onKey);
		};
	});
</script>

{#if open && stats}
	<div class="hud" aria-hidden="true">
		<div>ctx #{stats.contextId} · {stats.running ? 'running' : 'idle'}</div>
		<div>{stats.running ? stats.fps.toFixed(0) : '–'} fps · {stats.frameMs.toFixed(2)} ms cpu</div>
		<div>views {stats.visibleViews}/{stats.views}</div>
		<div>programs {stats.programs} · compiles {stats.compiles}</div>
		<div>{stats.width}×{stats.height} @{stats.pixelRatio.toFixed(2)}</div>
	</div>
{/if}

<style>
	.hud {
		position: fixed;
		top: 8px;
		right: 8px;
		z-index: 1000;
		padding: 6px 8px;
		border-radius: 4px;
		background: rgb(0 0 0 / 0.65);
		color: #cfe8df;
		font: 11px/1.45 ui-monospace, 'Cascadia Mono', Consolas, monospace;
		white-space: nowrap;
		pointer-events: none;
	}
</style>
