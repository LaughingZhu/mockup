# Contributing

Thanks for helping improve the visible-surface editor.

## Development

```bash
pnpm install
pnpm verify
```

The model service has a separate Python environment under
`services/model-service/.venv`; it is intentionally not part of the pnpm
workspace. Use the bundled fixture when you only need to check the browser
renderer.

Keep changes inside the package or app they serve. Add focused tests for
geometry invariants, abort/error behavior, persistence shape, and direct
manipulation. Do not introduce a private endpoint or a provider-specific branch
into the React component.

## Pull requests

Describe the user-visible behavior, the claim boundary, and the verification
commands you ran. If a change affects the renderer, include a screenshot or a
small synthetic fixture. If a change affects the model service, include the
Python version and a bounded health/inference check. Never add customer images,
credentials, signed URLs, or assets whose redistribution rights are unclear.
