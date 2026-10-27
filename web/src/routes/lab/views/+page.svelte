<script lang="ts">
	// Test page for the view system (M1): several DOM elements drawn by the shared canvas.
	// Scroll, resize, switch tabs and navigate home and back while watching the perf HUD.
	import { getRenderer } from '$lib/gl/context';
	import { TestPattern } from '$lib/drawables/test/TestPattern';

	const renderer = getRenderer();

	const hero = new TestPattern([0.25, 0.45, 0.7]);
	const left = new TestPattern([0.7, 0.35, 0.25]);
	const right = new TestPattern([0.3, 0.6, 0.35]);
	const wide = new TestPattern([0.55, 0.4, 0.65]);
</script>

<svelte:head>
	<title>Lab · views</title>
</svelte:head>

<main>
	<h1>View system test</h1>
	<p>
		Each box is a transparent DOM element; the shared canvas draws into its rectangle. Check: the 2 px
		border sits exactly on the box, the yellow marker is top-left, grid cells stay square, nothing
		"swims" during fast scrolling, and the HUD shows <em>idle</em> when no box is on screen.
	</p>

	<div class="view hero" {@attach renderer.view(hero)}></div>

	<div class="spacer">Scroll down: between the boxes nothing is visible, so the loop should idle.</div>

	<div class="row">
		<div class="view" {@attach renderer.view(left)}></div>
		<div class="view" {@attach renderer.view(right)}></div>
	</div>

	<div class="spacer"></div>

	<div class="view wide" {@attach renderer.view(wide)}></div>

	<p><a href="/">← Home</a> (the context id in the HUD must stay the same when you come back)</p>
</main>

<style>
	main {
		max-width: 960px;
		margin: 0 auto;
		padding: 2rem 1rem 4rem;
	}

	.view {
		height: 320px;
	}

	.hero {
		height: 60vh;
	}

	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	.wide {
		height: 200px;
	}

	.spacer {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 130vh;
		color: var(--muted);
	}
</style>
