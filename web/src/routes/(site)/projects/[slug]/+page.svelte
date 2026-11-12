<script lang="ts">
	// A project's page: the (site) layout shows it as the overlay over the scene; this only sets the head.
	import { portfolio } from '$lib/content/portfolio';

	let { data } = $props();
	// The first paragraph, for search engines and link previews
	const description = $derived(data.project.body.find((block) => block.kind === 'text')?.text ?? data.project.title);
</script>

<svelte:head>
	<title>{data.project.title} · {portfolio.name}</title>
	<meta name="description" content={description} />
</svelte:head>
