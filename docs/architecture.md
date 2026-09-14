# Architecture

```text
base image + design image
            │
            ├── stable references ── persistence (JSON only)
            │
            └── SurfaceProvider (optional, abortable)
                    │
                    └── full-image depth field
                              │
             depth-connected region at placement
             (whole-image drag by default)
                (optional candidate review mode)
                              │
             fixed depth grid + fixed surface mask
                              │
             placement → surface UV + connected print mask
                              │
               Three.js preview and PNG export
```

## Core

`packages/core/src/geometry.ts` turns a normalized depth map into a displaced
grid. The default full-image path labels depth-connected regions once and lets
`mapPlacement` choose the region at the current placement, so the artwork can
move across the photograph without a point-selected SAM surface. The optional
masked path remains available for candidate mode. Both paths update only the
design UV attribute and connected footprint during direct manipulation.

`buildConnectedPrintMask` keeps only the UV footprint connected to the current
anchor. This prevents a folded grid from exposing disconnected texture islands;
with the default depth field, the anchor can be anywhere in the photograph.

`packages/core/src/renderer.ts` owns Three.js. It creates one displaced plane,
photograph/design textures, a surface mask texture, and a shader that combines
the photographed lighting with design alpha. The live canvas and export path
share the same scene and material; export temporarily renders that scene at a
bounded output size and encodes a PNG.

## React layer

`SurfaceMockupEditor` owns asynchronous analysis state and the optional
candidate review path. It does not know whether a provider is SAM, a local
script, or a remote HTTP service. In the default whole-image mode, direct
manipulation changes only `SurfacePlacement`; the analysis effect is keyed by
the source identity and provider, not by placement or design.

The component is controlled when `placement` is supplied and uncontrolled when
only `defaultPlacement` is supplied. The ref handle exposes `exportPng`,
`resetPlacement`, and `chooseAnotherSurface`.

## Demo

`apps/demo` calls the local model service for Depth Anything V2 Small depth and
SAM ViT-B mask output. `createBundledProvider` remains an explicit offline
fixture for renderer checks. Uploading a local image is rasterized in the
browser and sent only to localhost:8080; no OSS or business API is involved.
