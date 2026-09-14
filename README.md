# Visible Surface Mockup

[English](README.md) · [简体中文](README.zh-CN.md)

A browser-first visible-surface Mockup editor. Place artwork inside a photo's
depth field, keep it editable while dragging, and use the same Three.js scene
for preview and PNG export.

Repository: [github.com/LaughingZhu/mockup](https://github.com/LaughingZhu/mockup)

This repository contains a self-contained local Demo. It does not require OSS,
business APIs, or an online Provider configuration. The model service listens
on `127.0.0.1:8080` only.

## Features

- Depth Anything V2 Small builds one relative-depth field for the full image.
- No object click or surface selection is required in the default flow.
- The current depth-connected region controls the visible print footprint.
- Drag artwork anywhere in the image, outside the image, and back again.
- Resize from all four corners, rotate from the top handle, and nudge by keyboard.
- Preview and PNG export share one Three.js renderer.
- SAM ViT-B remains available for the optional candidate API, but the default
  Demo does not use it to restrict whole-image dragging.
- A bundled fixture lets you check the renderer without starting the model service.

## Quick start

Requirements: Node.js 20+, pnpm 9+, and Python 3.12 (recommended).

### 1. Start the local model service

```bash
cd services/model-service
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

The first request downloads these Hugging Face model weights into the local
cache; later requests reuse them:

- `depth-anything/Depth-Anything-V2-Small-hf`
- `facebook/sam-vit-base`

The service does not upload images to OSS or access business project data.

### 2. Start the Demo

In another terminal:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:4173/>. The Demo starts in English; use the `中文`
button in the header to switch the interface to Chinese.

If the Python service is not available, click **Use bundled fixture** to check
dragging, resizing, rotation, and export with the checked-in synthetic sample.

## Interaction model

The default flow analyzes the source image once. Dragging updates placement and
UV coordinates without requesting the models again. The depth-connected region
at the current placement determines the visible footprint, so moving artwork
between a balloon, a cup, or another photographed area remains interactive.

When artwork is dragged outside the image, the WebGL print is hidden while the
placement box keeps a floating artwork preview. Dragging it back restores the
render. This follows the direct-manipulation behavior of the current Canvas
editor.

## Model roles

- **Depth Anything V2 Small** provides relative inverse depth. It drives grid
  displacement, arc-length UV coordinates, curvature, and foreshortening.
- **SAM ViT-B** provides optional semantic candidate masks. The default Demo
  keeps whole-image dragging free; candidate mode is available when a host
  explicitly needs semantic review.

The Demo hardcodes the model names and localhost endpoint. It does not expose an
OSS or Provider selector.

## Repository layout

```text
packages/core            depth geometry, connected regions, UV mapping, renderer
packages/react           React editor and direct-manipulation controls
apps/demo                local model Demo and synthetic fixture
services/model-service   Flask + Transformers local inference service
docs                     API, architecture, limitations, and roadmap
```

## Commands

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

`pnpm verify` runs TypeScript checks, Vitest, and the Vite production build.
The Python service is checked separately with a syntax and request-validation
smoke test. Model weights are never committed to Git.

## API usage

Hosts that already have depth and mask data can use
`@visible-surface-mockup/react`. The default `surfaceMode="whole"` uses the
full-image depth field; `surfaceMode="candidate"` enables optional candidate
review. Set `locale="zh"` for the built-in Chinese editor copy; English is the
default. See [docs/api.md](docs/api.md) and
[docs/architecture.md](docs/architecture.md).

Persistence stores only source/design references, selection metadata, and
placement. It does not store depth pixels, mask pixels, or temporary image URLs.

## Limitations

This is a single-view visible-surface approximation, not complete 3D
reconstruction. It does not infer hidden geometry, physical scale, camera
calibration, or arbitrary viewpoint changes. Relative depth is a mapping signal,
not a measurement. PNG export still depends on browser CORS and WebGL support.
See [docs/limitations.md](docs/limitations.md) for the claim boundary.

## Security and assets

The model service is intended for local development. Do not commit customer
images, credentials, signed URLs, model weights, or internal API addresses.
Confirm redistribution rights for sample and added assets. Read
[SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before opening
a pull request.

## License

The source code is available under the [MIT License](LICENSE). Model weights are
governed by their upstream licenses and are not distributed with this repository;
read each model card and license before use.
