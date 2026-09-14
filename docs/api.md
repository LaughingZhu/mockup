# API reference

## `@visible-surface-mockup/core`

Important exports:

- `MockupDepth`, `SurfaceMask`, `SurfacePlacement`, `SurfacePoint` — runtime
  geometry types.
- `SurfaceProvider`, `SurfaceAnalysisInput`, `SurfaceAnalysisResult`,
  `SurfaceCandidate`, `SurfaceSelection` — analysis boundary and metadata.
- `buildDepthSurface`, `mapPlacement`, `buildConnectedPrintMask`,
  `buildMaskedDepthSurface`, `mapMaskedPlacement`, `sampleDepth`,
  `clampPlacement` — pure geometry helpers.
- `createMockupRenderer` — Three.js renderer lifecycle.
- `serializeMockupState`, `deserializeMockupState`, `saveMockupState`,
  `loadMockupState`, `persistenceKey` — versioned persistence helpers.

## `@visible-surface-mockup/react`

`SurfaceMockupEditor` props:

| Prop | Purpose |
| --- | --- |
| `base` | `{ src, width?, height?, id? }` source image |
| `design` | Optional artwork image |
| `depth` + `surfaceMask` | Precomputed local inputs |
| `provider` | Optional abortable analysis provider; the bundled Demo uses fixed local model output instead |
| `sourceKey` | Stable source identity for selection reuse |
| `surfaceMode` | `whole` (default) uses one full-image depth field and depth-connected regions with no point selection; `candidate` exposes the optional SAM confirmation UI |
| `locale` | `en` (default) or `zh`; controls the editor's built-in loading, review, error, and placement UI copy |
| `negativePoints` | Optional normalized points to exclude while reviewing a model candidate |
| `selection` | JSON-safe persisted selection metadata |
| `placement` / `defaultPlacement` | Controlled or initial placement |
| `onPlacementChange` | Called after move, resize, rotate, or keyboard nudge |
| `onInteractionEnd` | Called once after a direct move, resize, or rotate ends; includes normalized point and placement |
| `onSurfaceSelectionChange` | Called after candidate confirmation or reset |

The ref handle is:

```ts
type SurfaceMockupEditorHandle = {
  exportPng(): Promise<{ blob: Blob; width: number; height: number }>
  resetPlacement(): void
  chooseAnotherSurface(): void
}
```

The editor does not re-run analysis while the artwork is being moved. Hosts that
need a Canvas-style handoff can use `onInteractionEnd` as the commit boundary:
keep the preview controlled during the gesture, then restore the native image
or persist the new placement after the callback.
