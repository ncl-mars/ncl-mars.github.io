// The dig site's terrain files (pipeline exports, or the placeholder from `npm run gen:terrain`).
// Imported, so the build gives them hashed URLs and handles the base path.
import heightmapUrl from '$lib/assets/terrain/heightmap.bin?url';
import heightmapJson from '$lib/assets/terrain/heightmap.json';
import mapsUrl from '$lib/assets/terrain/maps.png?lossless&format=webp';
import mapsJson from '$lib/assets/terrain/maps.json';
import { parseHeightmapMeta, parseMapsMeta } from './heightfield';

// The far map (the surroundings, low resolution, same format as the heightmap) is optional: a glob, so a
// missing file just means none
const farUrls = import.meta.glob<string>('../assets/terrain/farmap.bin', { eager: true, query: '?url', import: 'default' });
const farJsons = import.meta.glob<unknown>('../assets/terrain/farmap.json', { eager: true, import: 'default' });
const farUrl = Object.values(farUrls)[0];
const farJson = Object.values(farJsons)[0];

export const terrainAssets = {
	heightmapUrl,
	heightmap: parseHeightmapMeta(heightmapJson),
	farMapUrl: farUrl && farJson ? farUrl : null,
	farMap: farUrl && farJson ? parseHeightmapMeta(farJson, 'farmap.json') : null,
	mapsUrl,
	maps: parseMapsMeta(mapsJson)
};

export type TerrainAssets = typeof terrainAssets;
