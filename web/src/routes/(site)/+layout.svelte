<script module lang="ts">
	import { SurveyCamera } from '$lib/gl/camera';
	import { Terrain } from '$lib/drawables/terrain/Terrain';
	import { Dust } from '$lib/drawables/dust/Dust';
	import { terrainAssets } from '$lib/terrain/assets';
	import { tuning } from '$lib/tuning';
	import { pois } from '$lib/content/pois';
	import { projectFor } from '$lib/content/projects';
	import { Tour } from '$lib/navigation/tour';

	// Module level: the camera, the tour (which POI you're at) and the terrain survive navigating away and
	// back. They read their settings live from `tuning`, which the dev panel edits.
	const camera = new SurveyCamera(tuning.camera, tuning.controls);
	const terrain = new Terrain(camera, terrainAssets, tuning);
	const dust = new Dust(camera, terrain, tuning.dust);
	const tour = new Tour(camera, pois, () => terrain.ground, tuning.flight, tuning.start);
	/** Dev only: free camera input (pan, zoom, rotate) to frame POI views. */
	const dev = { freeCamera: false };

	/** The project's place, for the card's first line: E x · N −z, as in the legend. */
	function placeOf(poiId: string): string | undefined {
		const poi = pois.find((p) => p.id === poiId);
		if (!poi) return undefined;
		const signed = (v: number) => String(Math.round(v)).replace('-', '−');
		return `E ${signed(poi.at[0])} · N ${signed(-poi.at[1])}`;
	}
</script>

<script lang="ts">
	// The dig site, shared by `/` and `/projects/<slug>/`: this layout stays mounted between them, so the
	// scene never reloads. One full-viewport element with two views, drawn in the order they are attached:
	// the terrain (raymarched ground + atmosphere, writing depth), then the dust over it.
	// Home is the overview; clicking a label (or a menu entry) flies to that POI, clicking the current POI's
	// label goes back home, as you left it. Around the current POI, dragging turns and the wheel zooms.
	// Once the camera has arrived at a POI with a project, its label shows a Data button: it opens the
	// project's card over the scene, at /projects/<slug>/. The URL is the truth: back closes the card, and a
	// project's URL (link, back, forward) brings the camera to its POI.
	// Perf tuning from the URL: ?steps=48 (march iteration cap), ?dpr=1 (pixel-ratio cap).
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getRenderer } from '$lib/gl/context';
	import { surveyControls } from '$lib/gl/controls';
	import { tourControls } from '$lib/navigation/tour';
	import { actions, onTuningChange, readouts, setTuning } from '$lib/tuning';
	import Legend from '$lib/components/Legend.svelte';
	import ProjectOverlay from '$lib/components/ProjectOverlay.svelte';

	let { children } = $props();

	const renderer = getRenderer();

	let site: HTMLElement;
	let needle: SVGGElement;
	let current = $state(tour.current);
	/** The POI the camera has arrived at (−1 during a flight): its label shows the Data button. */
	let arrived = $state(-1);
	const dataAt = $derived(arrived !== -1 && projectFor(pois[arrived].id) ? arrived : -1);
	const project = $derived(page.data.project);
	let mounted = false;

	function openProject(slug: string) {
		goto(resolve(`/projects/${slug}/`), { state: { fromScene: true }, noScroll: true, keepFocus: true });
	}

	/** Back to the dig site's URL: a history step back if the card was opened from the scene. */
	function closeProject() {
		if (page.state.fromScene) history.back();
		else goto(resolve('/'), { replaceState: true, noScroll: true, keepFocus: true });
	}

	// A project's URL brings the camera to its POI: jumping when the page opens on it, flying on back / forward
	$effect(() => {
		const slug = project?.slug;
		untrack(() => {
			if (!slug) return;
			const index = pois.findIndex((poi) => poi.id === slug);
			if (index !== -1 && index !== tour.current) tour.go(index, !mounted);
		});
	});

	// The card closed: the keyboard goes back to the scene
	let hadProject = false;
	$effect(() => {
		const open = !!project;
		if (hadProject && !open) site.focus({ preventScroll: true });
		hadProject = open;
	});

	onMount(() => {
		mounted = true;
		// Keyboard controls work right away, without a focus ring nobody asked for
		if (!project) site.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
		// A project's URL may have moved the tour already
		current = tour.current;
		arrived = tour.flying ? -1 : tour.current;
		tour.onChange = (index) => {
			current = index;
			arrived = -1;
		};
		tour.onArrive = (index) => (arrived = index);

		// Compass needle follows the heading: written straight to the DOM after each frame, only on change
		let shownYaw = NaN;
		const stopCompass = renderer.onFrame(() => {
			if (camera.yaw === shownYaw) return;
			shownYaw = camera.yaw;
			needle.setAttribute('transform', `rotate(${(camera.yaw * 180) / Math.PI} 16 16)`);
		});

		const stopTuning = onTuningChange((group) => {
			// Panel edits to the ground itself (not the atmosphere) need a re-march of the terrain cache
			if (group === 'march' || group === 'shading' || group === 'farField' || group === 'fog') terrain.invalidate();
			// A new start view moves home and every POI view: show the current one's new framing
			if (group === 'start' && !dev.freeCamera) tour.reframe();
		});
		readouts.set(
			'terrain',
			() =>
				`terrain ${terrain.marchedLastFrame ? 'marching' : 'cached'}${terrain.roughShown ? ' · rough' : ''} · ${terrain.marches} marches`
		);

		readouts.set('camera', () => {
			const deg = 180 / Math.PI;
			const heading = (((-camera.yaw * deg) % 360) + 360) % 360; // compass: 0 north, 90 east
			return `pitch ${(camera.pitch * deg).toFixed(1)}° · heading ${heading.toFixed(0)}° · distance ${camera.distance.toFixed(0)}`;
		});
		readouts.set('tour', () =>
			dev.freeCamera
				? 'free camera'
				: `poi ${tour.current + 1}/${pois.length} · ${pois[tour.current].title}${tour.flying ? ' · flying' : ''}`
		);

		if (import.meta.env.DEV) {
			actions.set('Free camera', () => {
				dev.freeCamera = !dev.freeCamera;
				if (dev.freeCamera) camera.stop();
				else tour.go(tour.current); // back to the POI's framing
				site.focus({ preventScroll: true });
				return dev.freeCamera ? 'free camera: drag, wheel, right-drag, keys' : 'back to the POIs';
			});
			actions.set('Copy pose', async () => {
				// Relative to the start view, as POI views are (content/pois.ts)
				const { target, distance, heading } = camera.pose();
				const start = tuning.start;
				const turn = ((((heading - start.heading) % 360) + 540) % 360) - 180;
				const view = `view: { target: [${target[0].toFixed(1)}, ${target[1].toFixed(1)}], zoom: ${(distance / start.distance).toFixed(2)}, turn: ${turn.toFixed(0)} }`;
				await navigator.clipboard.writeText(view);
				return `copied ${view}`;
			});
			actions.set('Use view as start', () => {
				const { target, distance, heading } = camera.pose();
				setTuning('start', 'x', Math.round(target[0]));
				setTuning('start', 'z', Math.round(target[1]));
				setTuning('start', 'distance', Math.round(distance));
				setTuning('start', 'heading', Math.round(heading));
				return 'start view set: Save defaults to keep it';
			});
		}

		const params = new URLSearchParams(location.search);
		const steps = Number(params.get('steps'));
		if (steps > 0) tuning.march.steps = steps;
		const dpr = Number(params.get('dpr'));
		const previous = dpr > 0 ? renderer.setMaxPixelRatio(dpr) : null;

		return () => {
			mounted = false;
			tour.onChange = null;
			tour.onArrive = null;
			stopCompass();
			stopTuning();
			readouts.delete('terrain');
			readouts.delete('camera');
			readouts.delete('tour');
			actions.delete('Free camera');
			actions.delete('Copy pose');
			actions.delete('Use view as start');
			if (previous !== null) renderer.setMaxPixelRatio(previous);
		};
	});
</script>

<!-- Focusable for the keyboard controls, which the attachments add (Svelte can't see them) -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="site"
	role="application"
	aria-label="Dig site. Select a label or a menu entry to fly there; at a point of interest, Data opens its project. Drag or the left and right arrows turn the view, the wheel, a pinch or the up and down arrows zoom, Escape goes back home."
	tabindex="0"
	inert={!!project}
	bind:this={site}
	{@attach renderer.view(terrain)}
	{@attach renderer.view(dust)}
	{@attach tourControls(tour, { enabled: () => !dev.freeCamera && !project, settings: tuning.controls })}
	{@attach surveyControls(camera, {
		ground: () => terrain.ground,
		settings: tuning.controls,
		enabled: () => dev.freeCamera && !project
	})}
>
	<Legend
		items={pois}
		{camera}
		ground={() => terrain.ground}
		{current}
		{dataAt}
		onselect={(i) => tour.select(i)}
		ondata={(i) => openProject(pois[i].id)}
	/>
</div>

<!-- The heading, for orientation (a display: turn by dragging the view) -->
<div class="compass" title="Heading">
	<svg viewBox="0 0 32 32" aria-hidden="true">
		<circle class="ring" cx="16" cy="16" r="14.5" />
		<g bind:this={needle}>
			<path class="north" d="M16 5 L19.5 16 L12.5 16 Z" />
			<path class="south" d="M16 27 L19.5 16 L12.5 16 Z" />
		</g>
	</svg>
</div>

<header class="masthead" inert={!!project}>
	<p class="name">Portfolio</p>
	<!-- Straight to any POI; the first is home -->
	<nav aria-label="Points of interest">
		<ol>
			{#each pois as poi, i (poi.id)}
				<li>
					<button
						type="button"
						class:current={i === current}
						aria-current={i === current ? 'location' : undefined}
						onclick={() => tour.go(i)}
					>
						<span class="number">{String(i + 1).padStart(2, '0')}</span>{poi.title}
					</button>
				</li>
			{/each}
		</ol>
	</nav>
	<a href="/lab/views/">lab: views</a>
</header>

<!-- Outside the site element, so its wheel and keys don't reach the tour -->
{#if project}
	{#key project.slug}
		<ProjectOverlay {project} kicker={placeOf(project.slug)} onclose={closeProject} />
	{/key}
{/if}

{@render children()}

<style>
	.site {
		position: relative;
		height: 100vh;
		height: 100dvh;
		touch-action: none;
		user-select: none;
	}

	.site:global(.grabbing) {
		cursor: grabbing;
	}

	.site:global(.rotating) {
		cursor: ew-resize;
	}

	.site:focus {
		outline: none;
	}

	.site:focus-visible {
		outline: 2px solid rgb(255 255 255 / 0.6);
		outline-offset: -2px;
	}

	.compass {
		position: fixed;
		right: 1.25rem;
		bottom: 1.25rem;
		width: 2.75rem;
		height: 2.75rem;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: rgb(20 21 23 / 0.35);
		backdrop-filter: blur(3px);
		pointer-events: none;
	}

	.compass svg {
		display: block;
		width: 100%;
		height: 100%;
	}

	.compass .ring {
		fill: none;
		stroke: rgb(255 255 255 / 0.35);
		stroke-width: 1;
	}

	.compass .north {
		fill: #e8875a;
	}

	.compass .south {
		fill: rgb(255 255 255 / 0.75);
	}

	.masthead {
		position: fixed;
		top: 0;
		left: 0;
		padding: 1.25rem 1.5rem;
		color: var(--fg);
		pointer-events: none;
	}

	.masthead .name {
		margin: 0 0 0.9rem;
		font-size: 1.25rem;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.masthead ol {
		margin: 0 0 1rem;
		padding: 0;
		list-style: none;
	}

	.masthead li button {
		display: flex;
		gap: 0.7em;
		padding: 0.25rem 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		font-size: 1.05rem;
		opacity: 0.7;
		cursor: pointer;
		pointer-events: auto;
		text-shadow: 0 0 0.6em var(--bg);
	}

	.masthead li button:hover,
	.masthead li button:focus-visible,
	.masthead li button.current {
		opacity: 1;
	}

	.masthead li button.current {
		font-weight: 600;
	}

	.masthead li button:focus-visible {
		outline: 1px solid currentColor;
		outline-offset: 2px;
	}

	.number {
		font-family: var(--font-mono);
		font-size: 0.9em;
		font-variant-numeric: tabular-nums;
		opacity: 0.7;
	}

	.masthead a {
		font-size: 0.85rem;
		pointer-events: auto;
	}
</style>
