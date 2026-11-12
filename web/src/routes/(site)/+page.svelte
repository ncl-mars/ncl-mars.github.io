<script lang="ts">
	// Home: the landscape itself, drawn by the (site) layout. Nothing else on this page.
	import { portfolio } from '$lib/content/portfolio';
</script>

<svelte:head>
	<title>{portfolio.name}</title>
	{#if portfolio.description}
		<meta name="description" content={portfolio.description} />
	{/if}
</svelte:head>

<h1 class="visually-hidden">{portfolio.name}</h1>

<style>
	/* At the top, without the heading's margin: placed where it would flow (under the full-height scene), it stuck
	   out below the window, so the home page had a scrollbar that a project's page didn't, and the canvas changed
	   width when a card opened */
	.visually-hidden {
		position: absolute;
		top: 0;
		left: 0;
		margin: 0;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
