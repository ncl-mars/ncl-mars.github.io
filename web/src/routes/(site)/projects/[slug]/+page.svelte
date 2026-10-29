<script lang="ts">
	// A project's page: the (site) layout shows it as the overlay over the scene; this only sets the head.
	let { data } = $props();
</script>

<svelte:head>
	<title>{data.project.title} · Portfolio</title>
	<meta name="description" content={data.project.presentation[0]} />
</svelte:head>
