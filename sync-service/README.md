# iCloud Calendar Sync Service

Local sync service for the iCloud Calendar Wallpaper. Fetches events from iCloud via CalDAV and exposes a REST API for the wallpaper.

All Python dependencies run inside a **virtual environment** (`.venv`). Do not install packages globally.

## Prerequisites

- Python 3.10+
- Apple ID with iCloud Calendar enabled
- [App-specific password](https://support.apple.com/en-us/HT204397) (not your main Apple ID password)

## Setup (Windows)

From the `sync-service` folder:

```powershell
.\setup.ps1
```

This will:

1. Create `.venv` if missing
2. Install dependencies into the venv
3. Copy `.env.example` to `.env` if missing

Edit `.env` with your credentials:

```
APPLE_ID=your_apple_id@icloud.com
APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

## Run

```powershell
.\run.ps1
```

Or double-click `run.bat`. The launcher starts the sync service as a background tray app. The API listens on `http://127.0.0.1:8765` by default.

The tray icon is named **iCloud Calendar Sync**. Right-click it to:

- **Open Directory**
- **Exit**

Only one instance can use the port at a time. If you see **error 10048** (port already in use), a copy is already running — check Task Manager for `python.exe` or run:

```powershell
netstat -ano | findstr :8765
taskkill /PID <pid> /F
```

`run.ps1` detects a busy port and prints the PID before exiting.

## Manual venv commands

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service status and last sync time |
| GET | `/settings` | Safe sync settings without exposing the app password |
| POST | `/settings` | Update Apple ID, app password, and sync interval |
| GET | `/calendars` | List synced calendars |
| GET | `/events?from=&to=` | Events in ISO date range |
| GET | `/notes/files` | List markdown files when notes are enabled |
| GET | `/notes/file?path=` | Read parsed markdown tasks from one notes file |
| POST | `/notes/task` | Toggle one markdown task atomically |

## Logs

Logs are written to `logs/` in English. The service keeps only recent logs and automatically removes files older than 7 days.

## Windows Autostart (optional)

Create a shortcut to `run_hidden.vbs` in:

`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`

This starts the tray app without showing a terminal window.

## Security

- Credentials stay in `.env` on your machine only.
- The wallpaper never receives or stores Apple ID credentials.
- Do not commit `.env`, `.venv/`, or `cache/` to version control.
