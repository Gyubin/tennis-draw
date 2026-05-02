# Simple Tennis Matcher

Mobile-first tennis doubles scheduler for GitHub Pages.

The current repository keeps the original Python CLI in `python/` as a reference
implementation and serves the browser app from `web/`.

## Web App

```bash
cd web
npm install
npm run dev
```

The web app stores roster, weekly participants, settings, and the latest schedule
in browser `localStorage`. Data persists on the same device, browser, and GitHub
Pages URL. Use the JSON export/import controls to move data to another device.

## Python Reference

```bash
cd python
uv run matcher
```

Python tests:

```bash
cd python
uv run python -m unittest discover tests
```

## Deployment

GitHub Pages builds `web/` and publishes `web/dist` through the workflow in
`.github/workflows/pages.yml`.
