# Distribution Strategy

## What is now protected better

- The extension no longer depends on account or license services.
- Browser-agent planning/action prompts run from the extension runtime.
- The extension no longer needs to ship the strongest browser-agent system prompt.

## What still cannot be hidden fully

- Content scripts, DOM action code, UI logic, and message routing must still run in the browser.
- Anything shipped in the extension package can still be inspected eventually.

## Practical launch strategy

1. Keep premium logic, prompt logic, and provider API keys on the backend.
1. Keep any optional premium logic outside the extension when needed, but avoid mandatory account/license gating for core use.
2. Ship the extension as a bundled production build instead of raw source files.
3. Minify and obfuscate the built bundle before uploading to the Chrome Web Store.
4. Disable source maps for the store package.
5. Apply abuse/rate-limit controls without mandatory account/license activation for local-first users.

## Best next implementation step

Add a build pipeline that:

- bundles `src/` into `dist/`
- minifies all JavaScript
- obfuscates the final bundle
- packages only `dist/`, assets, and `manifest.json`

This is the same broad pattern used by commercial extensions: keep the valuable logic server-side, then obfuscate the unavoidable client-side layer.
