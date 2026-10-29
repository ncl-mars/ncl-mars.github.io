<script lang="ts">
	// A project's page: the (site) layout shows it as the overlay over the scene; this only sets the head.
	import { portfolio } from '$lib/content/portfolio';

	let { data } = $props();
</script>

<svelte:head>
	<title>{data.project.title} · {portfolio.name}</title>
	<meta name="description" content={data.project.presentation[0] ?? data.project.title} />
</svelte:head>
