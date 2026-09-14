# Limitations and honest claim boundary

The project implements a single-view visible-surface editor. It does not claim
to reconstruct a complete object or a metric 3D scene.

- A depth map is relative inverse depth. It supplies a useful deformation field,
  not real-world scale or camera calibration.
- The default editor uses a full-image depth field and depth-connected regions
  so every image position remains draggable. It does not claim semantic object
  separation; hosts that need a semantic region can opt into candidate mode.
- The default path calls the local Depth Anything V2 Small + SAM ViT-B service,
  but uses the depth field across the whole image. The bundled fixture is a
  fallback for renderer checks; it does not represent model quality.
- The bundled fixture is intentionally synthetic. Uploaded images in the demo
  use the local model service; production applications should provide their own
  depth adapter and add segmentation only when semantic regions are required.
- Hidden surfaces, back sides, severe self-occlusion, and arbitrary viewpoint
  changes are out of scope.
- PNG export requires images that can be drawn to a canvas under the browser's
  CORS rules. A signed URL without the right response headers will render in an
  `<img>` but fail canvas export.
- Large source images are bounded to a 4096 px export side and a 1280 px preview
  side by default. Hosts may fork the renderer policy when memory budgets differ.
- Three.js/WebGL is required for the depth-aware renderer. A host that needs a
  no-WebGL path should provide a separate, explicitly labeled 2D fallback.
