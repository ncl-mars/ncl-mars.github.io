<script module lang="ts">
	import { SurveyCamera } from '$lib/gl/camera';
	import { Terrain } from '$lib/drawables/terrain/Terrain';
	import { Dust } from '$lib/drawables/dust/Dust';
	import { LegendShadows, MAX_LABEL_SHADOWS } from '$lib/drawables/legend-shadows/LegendShadows';
	import { LegendLines } from '$lib/legend/lines';
	import { terrainAssets } from '$lib/terrain/assets';
	import { tuning } from '$lib/tuning';
	import { pois } from '$lib/content/pois';
	import { portfolio } from '$lib/content/portfolio';
	import { projectFor } from '$lib/content/projects';
	import { Tour } from '$lib/navigation/tour';

	// Module level: the camera, the tour (which POI you're at) and the terrain survive navigating away and
	// back. They read their settings live from `tuning`, which the dev panel edits.
	const camera = new SurveyCamera(tuning.camera, tuning.controls);
	const terrain = new Terrain(camera, terrainAssets, tuning);
	const dust = new Dust(camera, terrain, tuning.dust);
	// The legend writes its lines in 3D here after each frame; their shadows are drawn in the god rays
	const legendLines = new LegendLines(pois.length * 2, Math.min(pois.length, MAX_LABEL_SHADOWS));
	const legendShadows = new LegendShadows(camera, terrain, legendLines, tuning.legendShadows);
	const tour = new Tour(camera, () => terrain.ground, tuning.flight, tuning.start);
	/** Dev only: free camera input (pan, zoom, rotate) to frame the start view. */
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
	// The camera stays at home, the overview: dragging turns and the wheel zooms around its pivot, Home goes back
	// to the start view. Clicking a label (or a menu entry) opens its project's card over the scene, at
	// /projects/<slug>/, without moving the camera. The URL is the truth: back closes the card, and a project's
	// URL (link, back, forward) opens it.
	// Perf tuning from the URL: ?steps=48 (march iteration cap), ?dpr=1 (pixel-ratio cap).
	import { onMount } from 'svelte';
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
	let masthead: HTMLElement;
	let toggle: HTMLButtonElement;
	/** Phones: the POI menu is folded behind a Projects button, and unfolded by tapping it. */
	let menuOpen = $state(false);
	const project = $derived(page.data.project);
	/** The open project's POI (its menu entry is marked), or −1. */
	const current = $derived(project ? pois.findIndex((poi) => poi.id === project.slug) : -1);

	/** Phones: fold the menu, the keyboard going back to its button if `focus`. */
	function foldMenu(focus: boolean) {
		if (!menuOpen) return;
		menuOpen = false;
		if (focus) toggle.focus();
	}

	/** A menu entry: open its project, and fold the menu (phones) */
	function choose(index: number) {
		foldMenu(true);
		open(index);
	}

	/** A label or a menu entry: POI `index`'s project card, if it has one (some text or media). */
	function open(index: number) {
		const slug = pois[index].id;
		if (!projectFor(slug)) return;
		goto(resolve(`/projects/${slug}/`), { state: { fromScene: true }, noScroll: true, keepFocus: true });
	}

	/** Back to the dig site's URL: a history step back if the card was opened from the scene. */
	function closeProject() {
		if (page.state.fromScene) history.back();
		else goto(resolve('/'), { replaceState: true, noScroll: true, keepFocus: true });
	}

	// The card closed: the keyboard goes back to the scene
	let hadProject = false;
	$effect(() => {
		const open = !!project;
		if (hadProject && !open) site.focus({ preventScroll: true });
		hadProject = open;
	});

	onMount(() => {
		// Keyboard controls work right away, without a focus ring nobody asked for
		if (!project) site.focus({ preventScroll: true, focusVisible: false } as FocusOptions);

		const stopTuning = onTuningChange((group) => {
			// Panel edits to what the march caches (the ground, the light shafts, which the mist weighs) need a re-march
			const cached = ['march', 'shading', 'farField', 'fog', 'mist', 'shafts', 'water', 'ground'];
			if (cached.includes(group)) terrain.invalidate();
			// A new start view moves home: show it
			if (group === 'start' && !dev.freeCamera) tour.reframe();
		});
		readouts.set(
			'terrain',
			() =>
				`terrain ${terrain.marchedLastFrame ? 'marching' : 'cached'}${terrain.roughShown ? ' · rough' : ''} · ${terrain.marches} marches · motion ${terrain.roughInMotion ? 'rough' : 'sharp'}`
		);
		readouts.set('legendShadows', () => legendShadows.airReadout);

		readouts.set('camera', () => {
			const deg = 180 / Math.PI;
			const heading = (((-camera.yaw * deg) % 360) + 360) % 360; // compass: 0 north, 90 east
			return `pitch ${(camera.pitch * deg).toFixed(1)}° · heading ${heading.toFixed(0)}° · distance ${camera.distance.toFixed(0)}`;
		});
		readouts.set('tour', () => {
			if (dev.freeCamera) return 'free camera';
			return `${project ? `card · ${project.slug}` : 'home'}${tour.flying ? ' · flying' : ''}`;
		});

		if (import.meta.env.DEV) {
			actions.set('Free camera', () => {
				dev.freeCamera = !dev.freeCamera;
				if (dev.freeCamera) camera.stop();
				else tour.home(); // back to the start view
				site.focus({ preventScroll: true });
				return dev.freeCamera ? 'free camera: drag, wheel, right-drag, keys' : 'back to the start view';
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

		// Phones, menu unfolded: a tap outside it only folds it (the click that follows is swallowed, so a label
		// under the finger doesn't open its project), and Escape folds it before anything else sees the key.
		// Capture phase on the window: ahead of the scene's own listeners.
		let swallowUntil = 0;
		const onPointerDown = (event: PointerEvent) => {
			if (!menuOpen || masthead.contains(event.target as Node)) return;
			foldMenu(false);
			swallowUntil = event.timeStamp + 1000;
		};
		const onClick = (event: MouseEvent) => {
			if (event.timeStamp > swallowUntil) return;
			swallowUntil = 0;
			event.stopPropagation();
			event.preventDefault();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || !menuOpen) return;
			event.stopPropagation();
			foldMenu(true);
		};
		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('click', onClick, true);
		window.addEventListener('keydown', onKeyDown, true);

		const params = new URLSearchParams(location.search);
		const steps = Number(params.get('steps'));
		if (steps > 0) tuning.march.steps = steps;
		const dpr = Number(params.get('dpr'));
		const previous = dpr > 0 ? renderer.setMaxPixelRatio(dpr) : null;

		return () => {
			stopTuning();
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('click', onClick, true);
			window.removeEventListener('keydown', onKeyDown, true);
			readouts.delete('terrain');
			readouts.delete('legendShadows');
			readouts.delete('camera');
			readouts.delete('tour');
			actions.delete('Free camera');
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
	aria-label="Map of the projects. Select a label or a menu entry to open its project. Drag or the left and right arrows turn the view, the wheel, a pinch or the up and down arrows zoom, Home goes back to the start view."
	tabindex="0"
	inert={!!project}
	bind:this={site}
	{@attach renderer.view(terrain)}
	{@attach renderer.view(legendShadows)}
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
		shadowLines={legendLines}
		onselect={open}
		selectable={(i) => !!projectFor(pois[i].id)}
	/>
</div>

<header class="masthead" inert={!!project} bind:this={masthead}>
	<p class="name">{portfolio.name}</p>
	<!-- Any project, straight to its card. On phones the list folds behind a Projects button -->
	<nav aria-label="Projects">
		<button
			type="button"
			class="toggle"
			aria-expanded={menuOpen}
			aria-controls="poi-menu"
			bind:this={toggle}
			onclick={() => (menuOpen = !menuOpen)}
		>
			Projects
			<svg class="chevron" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1 5 5 9 1" /></svg>
		</button>
		<ol id="poi-menu" class="menu" class:open={menuOpen}>
			{#each pois as poi, i (poi.id)}
				<li>
					<!-- A POI without a card (no text, no media): its entry is plain text, like its label -->
					{#if projectFor(poi.id)}
						<button
							type="button"
							class:current={i === current}
							aria-current={i === current ? 'page' : undefined}
							onclick={() => choose(i)}
						>
							<span class="number">{String(i + 1).padStart(2, '0')}</span>{poi.title}
						</button>
					{:else}
						<span class="entry"><span class="number">{String(i + 1).padStart(2, '0')}</span>{poi.title}</span>
					{/if}
				</li>
			{/each}
		</ol>
	</nav>
	<!-- The view-system test page: a dev tool, not linked from the published site -->
	{#if import.meta.env.DEV}
		<a class="menu" class:open={menuOpen} href="/lab/views/">lab: views</a>
	{/if}
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

	.masthead li button,
	.masthead li .entry,
	.toggle {
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

	.masthead li .entry {
		cursor: default;
	}

	.masthead li button:hover,
	.masthead li button:focus-visible,
	.masthead li button.current {
		opacity: 1;
	}

	.masthead li button.current {
		font-weight: 600;
	}

	.masthead li button:focus-visible,
	.toggle:focus-visible {
		outline: 1px solid currentColor;
		outline-offset: 2px;
	}

	/* Desktop: the list is always there */
	.toggle {
		display: none;
	}

	/* Phones: folded behind the Projects button; tapping it unfolds the list (and the lab link) under it */
	@media (max-width: 700px) {
		.toggle {
			display: flex;
			align-items: center;
			gap: 0.5em;
			font-weight: 600;
			opacity: 1;
		}

		.chevron {
			width: 0.65em;
			height: 0.4em;
			fill: none;
			stroke: currentColor;
			stroke-width: 1.5;
			transition: transform 0.18s;
		}

		.toggle[aria-expanded='true'] .chevron {
			transform: rotate(180deg);
		}

		.masthead ol {
			margin: 0.2rem 0 0.6rem;
		}

		/* Folded: out of the layout, of taps, focus and screen readers. Unfolding fades it in */
		.menu:not(.open) {
			display: none;
		}

		.menu.open {
			animation: unfold 0.18s ease-out;
		}
	}

	@keyframes unfold {
		from {
			opacity: 0;
			transform: translateY(-0.3rem);
		}
	}

	@media (max-width: 700px) and (prefers-reduced-motion: reduce) {
		.chevron {
			transition: none;
		}

		.menu.open {
			animation: none;
		}
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
