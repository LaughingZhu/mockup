# Changelog

## Unreleased — interaction handoff

- Added an English-first README with a Chinese translation and an English/Chinese
  Demo language toggle; English is the default.
- Added a live drag preview in the demo: the artwork follows the pointer and
  is persisted only on drop.
- Added `onInteractionEnd` to the React editor so hosts have an explicit
  move/resize/rotate commit boundary.
- Fixed the default demo to use one full-image depth field: Depth Anything V2
  Small drives relief and every image position remains draggable. SAM ViT-B is
  retained for the explicit candidate-review path rather than constraining the
  default placement.
- Kept the optional selected-mask path for hosts that need semantic regions,
  while the default renderer no longer clips artwork when it reaches another
  photographed object.
- Added a local model service path for real Depth Anything V2 Small + SAM ViT-B
  inference without OSS or business API dependencies.
- Kept surface analysis fixed while placement changes; no provider call is
  made for each pointer move.

## 0.1.0 — local review build

- Added framework-neutral depth/mask geometry and a Three.js renderer.
- Added React candidate review and direct placement controls.
- Added a deterministic synthetic demo with precomputed sample data.
- Added persistence, architecture, limits, and contribution documentation.
- Public repository hosting and Demo deployment remain separate release steps;
  this checkout is licensed under MIT.
