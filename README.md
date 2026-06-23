# iCloud Calendar Wallpaper

Web wallpaper for **Lively Wallpaper** with a local Python sync service for iCloud CalDAV, event CRUD, and markdown notes.

## Project layout

```
LivelyInfo.json          Lively metadata
LivelyProperties.json    Lively customize menu
index.html               Entry point
css/styles.css           Styles
js/                      Frontend modules
sync-service/            Python FastAPI sync (not bundled in wallpaper zip)
  .venv/                 Local virtual environment (required)
scripts/package-lively.ps1  Build Lively zip
```

## Quick start

### 1. Sync service

From `sync-service/`:

```powershell
.\setup.ps1
```

Edit `.env` with your Apple ID and app-specific password, then run:

```powershell
.\run.ps1
```

The API listens on `http://127.0.0.1:8765` by default.

### 2. Lively wallpaper

Option A — import folder:

1. Open Lively Wallpaper.
2. Add wallpaper from folder containing `LivelyInfo.json`.
3. Right-click the wallpaper in the library and choose **Customize** to edit properties.

Option B — zip package:

```powershell
.\scripts\package-lively.ps1
```

Import `dist/icloud-calendar-wallpaper-lively.zip` into Lively.

### 3. Lively settings

- Set **Sync service port** in Customize to match the backend `PORT` (default `8765`).
- Enable keyboard input if you want to type in in-app modals:
  `Lively settings -> Wallpaper -> Interaction -> Wallpaper Input -> Keyboard`
- Use the in-app **Settings** panel for iCloud credentials, notes folder, and calendar filters.

## Architecture

- **Wallpaper**: presentation only. Fetches `http://127.0.0.1:PORT/*`. No iCloud credentials in wallpaper files.
- **sync-service**: CalDAV sync, cache, REST API, notes file I/O, and opening note files in the default app.

## Configuration ownership

| Setting | Stored in |
|---------|-----------|
| Colors, font, view, background host prefs | LivelyProperties (per monitor/layout) |
| Card/notes position, size, collapse | IndexedDB + localStorage + sync-service `cache/ui-state.json` |
| iCloud credentials, sync interval, notes folder | sync-service `.env` via Settings panel |
| Calendar filter checkboxes | localStorage via Settings panel |
| In-app wallpaper image | IndexedDB (data URL) + sync-service `cache/ui-state.json` |

## Security

- Credentials stay in `sync-service/.env` only.
- Do not commit `.env`, `.venv/`, or `cache/`.
- The Lively zip excludes the sync service and local secrets.

## Development

Open `index.html` in a browser for basic UI testing. Full calendar/notes behavior requires the sync service running locally.

Gadget positions and in-app wallpaper preferences are saved to `sync-service/cache/ui-state.json` because Lively's WebView2 clears browser storage on exit unless disk cache is enabled. Keep the sync service running (or autostart it) for layout persistence across reboots.

See [sync-service/README.md](sync-service/README.md) for API endpoints and autostart setup.
