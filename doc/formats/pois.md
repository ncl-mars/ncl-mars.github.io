# Points of interest format (v1)

Where the POIs stand on the terrain. One POI per project. Contract between the Houdini exporter (`hou/snippets/python/export_pois.py`) and the web loader (`web/src/lib/content/pois.ts`). Change it here first, then on both sides.

What each project shows (title, camera framing, text, media) is not in this file. It lives in the project's folder: [projects.md](projects.md). A re-export never overwrites it.

## File

`web/src/lib/assets/terrain/pois.json`, next to the heightmap.

```json
{
  "version": 1,
  "pois": [
    { "id": "test-pit", "x": 130, "z": -230 },
    { "id": "trench-a", "x": -70, "z": 40 }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `version` | format version (see Versioning) |
| `pois` | the POIs, **in menu order** (the exporter writes them in point order) |
| `id` | the POI's id: its project folder (`web/src/lib/assets/projects/<id>/`) and its URL (`/projects/<id>/`). Lowercase letters, digits and hyphens: `trench-a`, `site-2` |
| `x`, `z` | where the POI stands, in world units, in the heightmap's space ([heightmap.md](heightmap.md)) |

There is no height: the site sets each POI on the ground (plus the legend's anchor lift), so a point placed a little above or below it is fine.

## Houdini

One point per POI, in the space `export_heightmap.py` exports the heightfield in, with a string attribute `s@name` holding its id. Point order is menu order. The Python SOP is pass-through and writes on every cook, so bypass it when not exporting. It refuses a missing or malformed `name`, and a name used twice.

## Loader (web)

- Imported directly (`pois.json`), checked when the site loads. These stop the page with a message: an unknown version, an empty list, a malformed or repeated id, an `x` or `z` that isn't a number, a POI outside the heightmap's bounds.
- A POI whose folder doesn't exist yet gets a label made from its id (`north-ridge` → "North ridge") and a warning in the console. A folder whose id isn't in the file is left out, with a warning.

## Versioning

- New optional fields: no version bump. The loader ignores fields it doesn't know.
- Changing the meaning of a field: bump `version`. The loader rejects versions it doesn't support.
