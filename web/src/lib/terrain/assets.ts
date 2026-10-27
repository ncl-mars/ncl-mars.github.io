// The dig site's terrain files (pipeline exports, or the placeholder from `npm run gen:terrain`).
// Imported, so the build gives them hashed URLs and handles the base path.
import heightmapUrl from '$lib/assets/terrain/heightmap.bin?url';
import heightmapJson from '$lib/assets/terrain/heightmap.json';
import mapsUrl from '$lib/assets/terrain/maps.png?lossless&format=webp';
import mapsJson from '$lib/assets/terrain/maps.json';
import { parseHeightmapMeta, parseMapsMeta } from './heightfield';

export const terrainAssets = {
	heightmapUrl,
	heightmap: parseHeightmapMeta(heightmapJson),
	mapsUrl,
	maps: parseMapsMeta(mapsJson)
};

export type TerrainAssets = typeof terrainAssets;
