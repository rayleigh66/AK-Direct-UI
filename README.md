# AOKING Direct UI

Standalone **UI / workflow prototype** for the AOKING Direct wholesale ordering portal.

## Local development

Requirements: a Node.js version compatible with Vite 8, and npm.

```bash
npm install
npm run dev
```

Open the URL printed by Vite (configured development port: 3000).

```bash
npm run lint
npm run build
npm run preview
```

The project does **not** need a Google/Gemini API key, Google AI Studio, Google Cloud Run, or Google-hosted fonts to run. It uses locally available system font fallbacks.

## Scope and limitations

**This is a demonstration application, not a production ordering service.**

- State, including carts, orders, stock, audit events and account flags, is stored in React memory and resets on reload.
- Role switching is a demo feature, not authentication or server-side authorization.
- Password generation and reset are simulated in the frontend; real password validation, secure storage, login and sessions are not implemented.
- Stock reservation is a frontend simulation, **not an atomic database transaction** and must not be relied upon to prevent overselling.
- The “Excel import” screen operates on preloaded sample rows; it does not parse an uploaded spreadsheet.
- Prices, promotion dates, product codes, SKU images and copy are demonstration content requiring a separate PRD consistency review before production development.

Do not deploy this UI as a publicly accessible system containing real customers, credentials, orders or inventory.

## Planned review areas

1. Mobile-first buyer flows: browse products, filter, select SKU, adjust quantities, place orders, track progress.
2. English-only customer-facing copy; bilingual internal-facing copy.
3. Product management: create/edit products and SKUs, series, category, feature tags, per-color pictures, visibility.
4. Confirm business rules against the approved AOKING Direct PRD before changing MOQ, account, promotion or order behavior.
5. Introduce backend authentication, permission checks, persistent storage and safe inventory reservation before production use.
6. Add unit tests, end-to-end mobile tests, CI and a reproducible dependency lockfile.

## Branch policy

The UI cleanup is developed on a separate branch and proposed in a draft pull request. No automatic merge into `main`.
