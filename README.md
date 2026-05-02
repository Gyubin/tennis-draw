# Tennis Draw

Mobile-first tennis doubles scheduler for GitHub Pages.

The current repository keeps the original Python CLI in `python/` as a reference
implementation and serves the browser app from `web/`.

## Web App

```bash
cd web
npm install
npm start
```

The web app stores clubs, rosters, weekly participants, settings, and schedule
history in browser `localStorage`. Data persists on the same device, browser,
and GitHub Pages URL. Use the JSON export/import controls to move data to
another device.

Core workflows:

- Manage club rosters and weekly participants.
- Set per-player availability windows for the selected week.
- Generate tennis doubles schedules across configured courts and time slots.
- Review per-player statistics, sorted by men first and then women, with names
  ordered alphabetically within each gender.
- Adjust generated schedules by moving players between match slots. On touch
  devices, hold a player name for 0.5 seconds before dragging.
- Save schedule history and export or import local data as JSON.

Useful checks:

```bash
cd web
npm test
npm run build
```

## Deployment

GitHub Pages builds `web/` and publishes `web/dist` through the workflow in
`.github/workflows/pages.yml`.
