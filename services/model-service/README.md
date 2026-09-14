# Local model service

This service runs the two model roles used by the Mockup demo:

- Depth Anything V2 Small for relative depth;
- SAM ViT-B for prompted surface masks.

It accepts a browser PNG data URL and returns JSON-safe depth and mask arrays.
The endpoint only accepts data URLs, limits the request body to 12 MiB, and
allows CORS from the local Demo origins (`localhost:4173` and
`127.0.0.1:4173`). It does not use OSS, project IDs, or private Design API
routes.

## Setup

~~~bash
cd services/model-service
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
~~~

The first request downloads the two Hugging Face model weights into the local
cache. Later runs reuse them. The service listens on http://127.0.0.1:8080.
The pinned direct dependencies are tested with Python 3.12; CPU inference is
used automatically when CUDA is unavailable.

Start the Vite Demo in another terminal:

~~~bash
pnpm dev
~~~

If the service is not running, use the bundled fixture button in the Demo to
inspect the renderer without model inference.
