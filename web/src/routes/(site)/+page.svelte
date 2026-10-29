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
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
