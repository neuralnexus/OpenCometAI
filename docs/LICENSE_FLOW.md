# Local-Only Access (Legacy License Flow Removed)

Open Comet now runs in **local-first mode**:

- No website account is required.
- No license key is required.
- No cloud profile sync is required.

## What changed

- Browser startup is no longer gated by license validation.
- Sidepanel onboarding no longer requires sign-in or activation.
- Legacy `auth` and `opencometLicense` storage entries are cleared on startup.

## Privacy controls

- **History → Clear** removes saved local task history.
- **Token & Cost Usage → Clear all usage data** removes local usage counters.

## Inference behavior

- Inference uses your configured provider API key, or local Ollama if selected.
- Data remains local except for requests you explicitly make to your chosen model/search providers.
