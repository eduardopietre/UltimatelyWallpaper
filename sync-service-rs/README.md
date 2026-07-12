# Sync Service (Rust)

Drop-in replacement for the Python `sync-service`. Same HTTP API, `.env` keys, cache JSON shapes, and Windows tray — built for faster startup and lower memory.

## Requirements

- Rust 1.80+ (`cargo`)
- Windows (tray, notes dialogs, SMTC media)

## Setup

```powershell
cd sync-service-rs
copy .env.example .env
# Or copy credentials from the Python service:
# copy ..\sync-service\.env .env
# copy ..\sync-service\cache cache -Recurse
cargo build --release
```

Stop the Python sync service before starting Rust (only one process can bind the port).

## Run

```powershell
.\run.ps1
```

Or double-click / Startup shortcut to `run_hidden.vbs` (no console; launches the exe only).

Do **not** point Startup at `run.ps1` — PowerShell will flash a console. Prefer `run_hidden.vbs` or a shortcut directly to `target\release\sync-service-rs.exe` with “Run: Minimized” and start-in set to `sync-service-rs`.

Binary: `target\release\sync-service-rs.exe`

Default listen: `http://127.0.0.1:8765`

## Autostart (replace Python)

1. Remove any Startup shortcut that points at `sync-service\run_hidden.vbs`.
2. Create a shortcut to `sync-service-rs\run_hidden.vbs` in:

`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`

Prefer Task Scheduler “At log on” (no delay) targeting `target\release\sync-service-rs.exe` with working directory `sync-service-rs` for earlier start.

## Config

Same variables as Python (see `.env.example`):

`APPLE_ID`, `APP_PASSWORD`, `HOST`, `PORT`, `SYNC_INTERVAL_MINUTES`, `DAYS_PAST`, `DAYS_FUTURE`, `NOTES_ENABLED`, `NOTES_FOLDER_PATH`, optional `CALDAV_URL`, `CACHE_DIR`.

## Wallpaper

No wallpaper changes. Keep Lively `syncPort` aligned with `PORT`.

## Parity checklist

- [ ] `GET /health` → ok/degraded
- [ ] `GET /events` month view + colors
- [ ] Settings save (Apple ID / interval / notes)
- [ ] Create / edit / delete event
- [ ] Notes list, toggle, add, indent
- [ ] UI layout persists after restart
- [ ] Media / monitor gadgets
- [ ] Tray: Restart, Open Directory, Exit

## vs Python

| | Python | Rust |
|--|--------|------|
| Runtime | `.venv` + `pythonw` | Single release binary |
| Tray | After `/health` | Immediate |
| Memory | Higher (interpreter + deps) | Lower |

The Python `sync-service/` folder remains as a reference until you fully switch.
