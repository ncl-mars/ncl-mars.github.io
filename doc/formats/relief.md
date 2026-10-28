# Relief map format (v1)

A depth map per project image. It displaces the image's stratum in the core viewer, so the photo appears as a relief carved in the mineral (see [home-concept.md](../home-concept.md) § Core viewer). Produced in Houdini (ML depth estimation, or better a render's real depth pass), or with ComfyUI. Contract between that export and the web loader: change it here first, then on both sides.

## Files

Next to the colour image, same base name:

| File | Content |
|------|---------|
| `<name>.relief.bin` | raw relief samples, no header |
| `<name>.relief.json` | metadata |

## `<name>.relief.bin`

- IEEE 754 **half-float** (binary16), **little-endian**. In numpy: `astype('<f2').tofile(path)`.
- `width × height` values, row-major: `index = row * width + column`.
- **Row 0 is the top row of the image**, in the same orientation as the colour image. This differs from the heightmap, where row 0 is min Z.
- Values are **normalized to [0, 1]: 1 = closest to the viewer (raised), 0 = farthest (recessed)**.
  - ML models that output disparity / inverse depth (Depth Anything, MiDaS) already use "near = high": just normalize.
  - Models or render passes that output distance (far = high) must be inverted: `1 − normalized`.
- File size must be exactly `width * height * 2` bytes.

## `<name>.relief.json`

```json
{
	"version": 1,
	"width": 384,
	"height": 256,
	"format": "r16f"
}
```

`width / height` must match the colour image's aspect ratio (within 1%). The viewer fits the image into the stratum's square from this ratio.

## Guidance

- **Resolution:** 384–512 px on the long side is plenty. The relief is low-frequency, and the lighting normals are computed per pixel from this texture.
- **Range:** use the full 0..1 range. The viewer scales the relief height itself (panel: Core → Relief).
- **Clean-up:** a light blur removes ML noise that would read as grain under the raking light.
- **Renders:** prefer the real depth pass (normalized, inverted so near = 1) over ML: it's exact and clean.
- **Flat images** (UI, diagrams, text): export a constant 0.5. The stratum then shows a flat imprint.

## Loader (web)

- Import: `<name>.relief.bin?url` and `<name>.relief.json` directly.
- Check `version`, `format` and byte length; fail loudly on a mismatch.
- Upload as `R16F`, `LINEAR`, `CLAMP_TO_EDGE`, no mipmaps, no flip (image row 0 = texture row 0 = top). It's sampled in the vertex shader (displacement) and the fragment shader (normals).

## Versioning

- New optional fields: no version bump.
- Changing the meaning or layout of existing fields: bump `version`. The loader rejects versions it doesn't support.
