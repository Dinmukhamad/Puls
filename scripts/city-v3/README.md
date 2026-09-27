# City V3: CRM island art pipeline

This is the **single-island pilot**, not the full twenty-district specification.
The scene is original project artwork generated offline. No downloaded models,
fonts, textures, Blender installation or network calls are required.

From the repository root, after installing the frontend dependencies:

```powershell
node scripts/city-v3/build-island.mjs
node scripts/city-v3/verify-island.mjs
```

Dependencies: the frontend's pinned Three.js version and `meshoptimizer@0.22.0` (installed as the `meshoptimizer-pilot` alias)
(authoring only). The runtime decoder is the one already bundled with Three.js:

```ts
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
loader.setMeshoptDecoder(MeshoptDecoder);
```

The generator writes `frontend/public/city/v3-pilot/crm-island.glb` and its
`manifest.json`. It merges the original components into seventeen meshes by PBR
material, then compresses them with the required `EXT_meshopt_compression`
extension. Each encoded buffer is decoded and checked during generation.
Positions and normals use exponent filtering; the allowed maximum component
error is 0.002 scene units. Triangle roundtrips accept cyclic vertex rotations
while requiring unchanged winding.

## Visual direction

- Three rounded, progressively recessed glass storeys with ivory floor plates,
  slender brass mullions, planted terraces, a sheltered entrance and roof pergola.
- Quiet stone square, original geometric CRM lettering, seating and a Puls water
  feature; no imported font outlines.
- Landscaped stone quay, avenue trees, matching lamps, ring road and south bridge.
- Restrained palette: limestone and ivory, teal glazing, warm brass, several
  greens, warm timber and small terracotta flower accents.

Ambient shading is an artistic vertex-colour treatment. **It is not a baked
lightmap**, and the model does not contain fixed directional shadows. Let the
application provide sunlight, shadows, environment, water and moving actors.
The static pilot represents a completed CRM landmark. Five construction stages,
night/day lightmap sets and additional districts are deliberately not claimed.

## Coordinates and integration

The ground is horizontal XZ, +Y upward. Island top is approximately Y = 0.

| Element | Contract |
| --- | --- |
| Island radius | 18.02 |
| Building centre | `[0, 0, -2]` |
| Label anchor | object `crm-label-anchor`, `[0, 10.1, -2]` |
| Entrance anchor | object `crm-entrance-anchor`, `[0, 0.55, 3.8]` |
| Taxi route | radius 13.8, ground contact Y = 0.11 |
| Pedestrian route | radius 10.4, ground contact Y = 0.083 |
| Water height | -0.65 |
| Bridge | positive Z, ends at approximately Z = 23.925 |
| Night materials | `city-night-glass`, `city-night-lights` |

The manifest contains generated bounds, counts, bytes and the same anchors.
The bridge piers extend to Y = -2.56 beneath water. Geometry is merged for mobile
rendering, so raycasting should use a separate invisible building hit volume when
building-only selection is required; environment meshes are not building IDs.

For day/night, vary the emissive intensities of the two named materials rather
than replacing every glass material. The generator stores a subtle daylight
emission, not a night-lighting preset. Main lighting should remain external.

## Verification limits

The verifier checks the real compressed GLB through Three.js's GLTFLoader,
finite geometry, resource budgets, anchors, metadata and all material names.
It does not substitute for visual review, on-device FPS/memory measurements or
an extended iPhone thermal test. Run the scene in the app and inspect both day
and night before increasing the island count.
