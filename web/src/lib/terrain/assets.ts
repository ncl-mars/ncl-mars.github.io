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
// Optional too (doc/formats/terrain-maps.md): the materials' masks (without: ground everywhere), and the
// ground's colour, lossy since it's colour rather than data (without: Shading → Tint)
const materialUrls = import.meta.glob<string>('../assets/terrain/materials.png', {
	eager: true,
	query: '?lossless&format=webp',
	import: 'default'
});
const albedoUrls = import.meta.glob<string>('../assets/terrain/albedo.png', {
	eager: true,
	query: '?format=webp&quality=90',
	import: 'default'
});

export const terrainAssets = {
	heightmapUrl,
	heightmap: parseHeightmapMeta(heightmapJson),
	farMapUrl: farUrl && farJson ? farUrl : null,
	farMap: farUrl && farJson ? parseHeightmapMeta(farJson, 'farmap.json') : null,
	mapsUrl,
	maps: parseMapsMeta(mapsJson),
	materialsUrl: Object.values(materialUrls)[0] ?? null,
	albedoUrl: Object.values(albedoUrls)[0] ?? null
};

export type TerrainAssets = typeof terrainAssets;
