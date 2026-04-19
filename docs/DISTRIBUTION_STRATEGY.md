# Distribution Strategy

## What is now protected better

- The extension no longer depends on account or license services.
- Browser-agent planning/action prompts run from the extension runtime.

## What still cannot be hidden fully

- Content scripts, DOM action code, UI logic, and message routing must still run in the browser.
- Anything shipped in the extension package can still be inspected eventually.

## Practical launch strategy

1. Keep core extension behavior local-first and avoid mandatory website account/license dependencies.
2. Keep provider API keys user-managed in the extension settings (or use local Ollama).
3. Ship the extension as a bundled production build instead of raw source files.
4. Minify and obfuscate the built bundle before uploading to the Chrome Web Store.
5. Disable source maps for the store package.
6. Apply abuse/rate-limit controls without mandatory account or license activation.

## Best next implementation step

Add a build pipeline that:

- bundles `src/` into `dist/`
- minifies all JavaScript
- obfuscates the final bundle
- packages only `dist/`, assets, and `manifest.json`

This is the same broad pattern used by commercial extensions: keep the valuable logic server-side, then obfuscate the unavoidable client-side layer.
