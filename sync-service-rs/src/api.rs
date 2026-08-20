use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, Query, State};
use axum::http::Method;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::cors::{Any, CorsLayer};

use crate::caldav;
use crate::caldav::ics_build::{build_vevent_ical, validate_event_payload};
use crate::config::{
    apply_settings_to_environment, notes_enabled_from_value, read_env_file, write_env_values,
};
use crate::error::{friendly_sync_error, AppError};
use crate::models::*;
use crate::notes;
use crate::now_playing;
use crate::sync_job::AppState;
use crate::system_monitor;
use crate::ui_state::{merge_ui_state, read_ui_state};

const UI_STATE_BODY_LIMIT_BYTES: usize = 64 * 1024 * 1024;

pub fn router(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
        .allow_headers(Any);

    Router::new()
        .route("/health", get(health))
        .route("/settings", get(get_settings).post(update_settings))
        .route(
            "/ui-state",
            get(get_ui_state)
                .post(update_ui_state)
                // The wallpaper stores its selected background as a data URI
                // inside `wallpaperPrefs`, so a full snapshot runs well past
                // the 2 MB default and every save would be rejected.
                .layer(DefaultBodyLimit::max(UI_STATE_BODY_LIMIT_BYTES)),
        )
        .route("/calendars", get(calendars))
        .route(
            "/events",
            get(events)
                .post(create_calendar_event)
                .patch(update_calendar_event)
                .delete(delete_calendar_event),
        )
        .route("/sync", post(sync_now))
        .route("/notes/files", get(notes_files))
        .route("/notes/file", get(notes_file))
        .route("/notes/task", post(toggle_note_task))
        .route("/notes/task/add", post(add_note_task))
        .route("/notes/task/edit", post(edit_note_task))
        .route("/notes/task/subtask", post(add_note_subtask))
        .route("/notes/task/action", post(note_task_action))
        .route("/notes/pick-folder", post(pick_notes_folder_endpoint))
        .route("/notes/prompt", post(prompt_text_endpoint))
        .route("/notes/open-file", post(open_note_file_endpoint))
        .route("/system/metrics", get(system_metrics_endpoint))
        .route("/media/now-playing", get(now_playing_endpoint))
        .route("/media/control", post(media_control_endpoint))
        .route("/open-url", post(open_url_endpoint))
        .layer(cors)
        .with_state(state)
}

async fn health(State(state): State<Arc<AppState>>) -> Json<Value> {
    let meta = state.cache.metadata();
    let err = state.last_sync_error.read().clone();
    Json(json!({
        "status": if err.is_none() { "ok" } else { "degraded" },
        "lastSync": meta.as_ref().and_then(|m| m.get("updatedAt").cloned()),
        "error": err,
    }))
}

async fn get_settings(State(state): State<Arc<AppState>>) -> Json<SettingsResponse> {
    let cfg = state.config.read();
    let values = read_env_file(&cfg.env_path);
    let apple_id = values
        .get("APPLE_ID")
        .cloned()
        .unwrap_or_else(|| cfg.apple_id.clone());
    let app_password = values
        .get("APP_PASSWORD")
        .cloned()
        .unwrap_or_else(|| cfg.app_password.clone());
    let interval = values
        .get("SYNC_INTERVAL_MINUTES")
        .and_then(|v| v.parse().ok())
        .unwrap_or(cfg.sync_interval_minutes);
    let notes_enabled = notes_enabled_from_value(
        values
            .get("NOTES_ENABLED")
            .map(|s| s.as_str())
            .or(Some(if cfg.notes_enabled { "1" } else { "0" })),
    );
    let notes_folder_path = values
        .get("NOTES_FOLDER_PATH")
        .cloned()
        .unwrap_or_else(|| cfg.notes_folder_path.clone());

    Json(SettingsResponse {
        status: None,
        apple_id,
        sync_interval_minutes: interval,
        has_app_password: !app_password.is_empty(),
        notes_enabled,
        notes_folder_path,
    })
}

async fn update_settings(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SettingsRequest>,
) -> Result<Json<SettingsResponse>, AppError> {
    let apple_id = body.apple_id.trim().to_string();
    if apple_id.is_empty() {
        return Err(AppError::bad_request("APPLE_ID is required"));
    }
    let notes_folder_path = body
        .notes_folder_path
        .clone()
        .unwrap_or_default()
        .trim()
        .to_string();
    if body.notes_enabled {
        notes::normalize_notes_root(&notes_folder_path)?;
    }
    if body.sync_interval_minutes == 0 {
        return Err(AppError::bad_request("syncIntervalMinutes must be > 0"));
    }

    let mut updates = std::collections::HashMap::new();
    updates.insert("APPLE_ID".into(), apple_id.clone());
    updates.insert(
        "SYNC_INTERVAL_MINUTES".into(),
        body.sync_interval_minutes.to_string(),
    );
    updates.insert(
        "NOTES_ENABLED".into(),
        if body.notes_enabled { "1" } else { "0" }.into(),
    );
    updates.insert("NOTES_FOLDER_PATH".into(), notes_folder_path.clone());
    if let Some(password) = body.app_password.filter(|p| !p.is_empty()) {
        updates.insert("APP_PASSWORD".into(), password);
    }

    let env_path = state.config.read().env_path.clone();
    write_env_values(&env_path, &updates).map_err(|e| AppError::internal(e.to_string()))?;
    apply_settings_to_environment(&updates);

    {
        let mut cfg = state.config.write();
        cfg.reload_from_env();
        cfg.sync_interval_minutes = body.sync_interval_minutes.max(1);
        cfg.apple_id = apple_id.clone();
        cfg.notes_enabled = body.notes_enabled;
        cfg.notes_folder_path = notes_folder_path.clone();
        if let Some(password) = updates.get("APP_PASSWORD") {
            cfg.app_password = password.clone();
        }
    }
    state.sync_interval_notify.notify_waiters();

    let has_password = !state.config.read().app_password.is_empty();
    Ok(Json(SettingsResponse {
        status: Some("ok"),
        apple_id,
        sync_interval_minutes: body.sync_interval_minutes,
        has_app_password: has_password,
        notes_enabled: body.notes_enabled,
        notes_folder_path,
    }))
}

async fn get_ui_state(State(state): State<Arc<AppState>>) -> Json<UiStateResponse> {
    let dir = state.config.read().cache_dir.clone();
    Json(UiStateResponse {
        values: read_ui_state(&dir),
    })
}

async fn update_ui_state(
    State(state): State<Arc<AppState>>,
    Json(body): Json<UiStateUpdateRequest>,
) -> Result<Json<UiStateResponse>, AppError> {
    let dir = state.config.read().cache_dir.clone();
    if body.values.is_empty() {
        return Ok(Json(UiStateResponse {
            values: read_ui_state(&dir),
        }));
    }
    let merged = merge_ui_state(&dir, &body.values).map_err(|e| AppError::internal(e.to_string()))?;
    Ok(Json(UiStateResponse { values: merged }))
}

async fn calendars(State(state): State<Arc<AppState>>) -> Json<Value> {
    match state.cache.read() {
        Some(data) => Json(data.get("calendars").cloned().unwrap_or_else(|| json!([]))),
        None => Json(json!([])),
    }
}

#[derive(Debug, Deserialize)]
struct EventsQuery {
    from: Option<String>,
    to: Option<String>,
}

async fn events(
    State(state): State<Arc<AppState>>,
    Query(query): Query<EventsQuery>,
) -> Json<Value> {
    let Some(data) = state.cache.read() else {
        return Json(json!({
            "updatedAt": null,
            "calendars": [],
            "events": [],
        }));
    };

    if query.from.is_none() && query.to.is_none() {
        return Json(data);
    }

    let from_date = query
        .from
        .as_ref()
        .and_then(|s| DateTime::parse_from_rfc3339(&s.replace('Z', "+00:00")).ok())
        .map(|d| d.with_timezone(&Utc));
    let to_date = query
        .to
        .as_ref()
        .and_then(|s| DateTime::parse_from_rfc3339(&s.replace('Z', "+00:00")).ok())
        .map(|d| d.with_timezone(&Utc));

    let all_events = data
        .get("events")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let filtered: Vec<Value> = all_events
        .into_iter()
        .filter(|ev| event_overlaps_range(ev, from_date, to_date))
        .collect();

    Json(json!({
        "updatedAt": data.get("updatedAt"),
        "calendars": data.get("calendars").cloned().unwrap_or_else(|| json!([])),
        "events": filtered,
    }))
}

fn event_overlaps_range(
    ev: &Value,
    from_date: Option<DateTime<Utc>>,
    to_date: Option<DateTime<Utc>>,
) -> bool {
    let (start, mut end) = match event_range_bounds(ev) {
        Some(v) => v,
        None => return true,
    };
    if ev.get("allDay").and_then(|v| v.as_bool()).unwrap_or(false) && end > start {
        end -= Duration::days(1);
        if end < start {
            end = start;
        }
    }
    if let Some(range_start) = from_date {
        if end < range_start {
            return false;
        }
    }
    if let Some(range_end) = to_date {
        if start > range_end {
            return false;
        }
    }
    true
}

fn event_range_bounds(ev: &Value) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    let start_s = ev.get("start")?.as_str()?;
    let end_s = ev
        .get("end")
        .and_then(|v| v.as_str())
        .unwrap_or(start_s);
    let start = DateTime::parse_from_rfc3339(&start_s.replace('Z', "+00:00"))
        .ok()?
        .with_timezone(&Utc);
    let end = DateTime::parse_from_rfc3339(&end_s.replace('Z', "+00:00"))
        .ok()?
        .with_timezone(&Utc);
    Some((start, end))
}

async fn sync_now(State(state): State<Arc<AppState>>) -> Result<Json<Value>, AppError> {
    match state.run_sync().await {
        Ok(payload) => Ok(Json(json!({
            "status": "ok",
            "updatedAt": payload.updated_at,
        }))),
        Err(err) => {
            let detail = friendly_sync_error(&err);
            Err(AppError::internal(detail))
        }
    }
}

async fn resync_after_mutation(state: &AppState) -> (bool, Option<String>) {
    match state.run_sync().await {
        Ok(payload) => (false, Some(payload.updated_at)),
        Err(err) => {
            tracing::warn!("Mutation succeeded but cache sync failed: {err}");
            (true, None)
        }
    }
}

async fn create_calendar_event(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateEventRequest>,
) -> Result<Json<Value>, AppError> {
    if body.calendar_id.trim().is_empty() {
        return Err(AppError::bad_request("Calendar is required"));
    }
    let ical = build_vevent_ical(&body, None, None).map_err(AppError::bad_request)?;
    let cfg = state.config.read().clone();
    let result = caldav::create_event(&cfg, &body.calendar_id, &ical)
        .await
        .map_err(|e| {
            *state.last_sync_error.write() = Some(friendly_sync_error(&e));
            AppError::internal(e.to_string())
        })?;

    let (sync_failed, updated_at) = resync_after_mutation(&state).await;
    Ok(Json(json!({
        "status": "ok",
        "event": result,
        "updatedAt": updated_at,
        "syncFailed": sync_failed,
    })))
}

async fn update_calendar_event(
    State(state): State<Arc<AppState>>,
    Json(body): Json<UpdateEventRequest>,
) -> Result<Json<Value>, AppError> {
    if body.calendar_id.trim().is_empty() {
        return Err(AppError::bad_request("Calendar is required"));
    }
    validate_event_payload(&body).map_err(AppError::bad_request)?;
    let rid = if body.scope == "this" {
        Some(body.recurrence_id.as_str()).filter(|s| !s.is_empty())
    } else {
        None
    };
    let ical = build_vevent_ical(&body, Some(&body.uid), rid).map_err(AppError::bad_request)?;
    let cfg = state.config.read().clone();
    let recurrence_id = if body.recurrence_id.is_empty() {
        None
    } else {
        Some(body.recurrence_id.as_str())
    };
    let result = caldav::update_event(
        &cfg,
        &body.calendar_id,
        &body.uid,
        &ical,
        recurrence_id,
        &body.scope,
    )
    .await
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("not found") || msg.contains("required") {
            AppError::bad_request(msg)
        } else {
            *state.last_sync_error.write() = Some(friendly_sync_error(&e));
            AppError::internal(msg)
        }
    })?;

    let (sync_failed, updated_at) = resync_after_mutation(&state).await;
    Ok(Json(json!({
        "status": "ok",
        "event": result,
        "updatedAt": updated_at,
        "syncFailed": sync_failed,
    })))
}

async fn delete_calendar_event(
    State(state): State<Arc<AppState>>,
    Json(body): Json<DeleteEventRequest>,
) -> Result<Json<Value>, AppError> {
    let cfg = state.config.read().clone();
    let recurrence_id = if body.recurrence_id.is_empty() {
        None
    } else {
        Some(body.recurrence_id.as_str())
    };
    let result = caldav::delete_event(
        &cfg,
        &body.calendar_id,
        &body.uid,
        recurrence_id,
        &body.scope,
    )
    .await
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("not found") {
            AppError::bad_request(msg)
        } else {
            *state.last_sync_error.write() = Some(friendly_sync_error(&e));
            AppError::internal(msg)
        }
    })?;

    let (sync_failed, updated_at) = resync_after_mutation(&state).await;
    Ok(Json(json!({
        "status": "ok",
        "event": result,
        "updatedAt": updated_at,
        "syncFailed": sync_failed,
    })))
}

fn require_notes(state: &AppState) -> Result<String, AppError> {
    let cfg = state.config.read();
    if !cfg.notes_enabled {
        return Err(AppError::not_found("Notes are disabled"));
    }
    Ok(cfg.notes_folder_path.clone())
}

async fn notes_files(State(state): State<Arc<AppState>>) -> Result<Json<Value>, AppError> {
    let cfg = state.config.read().clone();
    let mut config = notes::get_notes_config(&cfg);
    if !cfg.notes_enabled || cfg.notes_folder_path.is_empty() {
        if let Some(obj) = config.as_object_mut() {
            obj.insert("files".into(), json!([]));
        }
        return Ok(Json(config));
    }
    let files = notes::list_markdown_files(&cfg.notes_folder_path)?;
    if let Some(obj) = config.as_object_mut() {
        obj.insert("files".into(), Value::Array(files));
    }
    Ok(Json(config))
}

#[derive(Debug, Deserialize)]
struct NotesFileQuery {
    path: String,
}

async fn notes_file(
    State(state): State<Arc<AppState>>,
    Query(query): Query<NotesFileQuery>,
) -> Result<Json<Value>, AppError> {
    let folder = require_notes(&state)?;
    Ok(Json(notes::read_note_file(&folder, &query.path)?))
}

async fn toggle_note_task(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ToggleNoteTaskRequest>,
) -> Result<Json<Value>, AppError> {
    let folder = require_notes(&state)?;
    Ok(Json(notes::set_task_checked(
        &folder,
        &body.path,
        body.line_index,
        body.checked,
        body.expected_text.as_deref(),
    )?))
}

async fn add_note_task(
    State(state): State<Arc<AppState>>,
    Json(body): Json<AddNoteTaskRequest>,
) -> Result<Json<Value>, AppError> {
    let folder = require_notes(&state)?;
    Ok(Json(notes::add_task(
        &folder,
        &body.path,
        &body.text,
        body.after_line_index,
    )?))
}

async fn edit_note_task(
    State(state): State<Arc<AppState>>,
    Json(body): Json<EditNoteTaskRequest>,
) -> Result<Json<Value>, AppError> {
    let folder = require_notes(&state)?;
    Ok(Json(notes::update_task_text(
        &folder,
        &body.path,
        body.line_index,
        &body.text,
        body.expected_text.as_deref(),
    )?))
}

async fn add_note_subtask(
    State(state): State<Arc<AppState>>,
    Json(body): Json<AddSubtaskRequest>,
) -> Result<Json<Value>, AppError> {
    let folder = require_notes(&state)?;
    Ok(Json(notes::add_subtask(
        &folder,
        &body.path,
        body.parent_line_index,
        &body.text,
        body.expected_text.as_deref(),
    )?))
}

async fn note_task_action(
    State(state): State<Arc<AppState>>,
    Json(body): Json<NoteTaskActionRequest>,
) -> Result<Json<Value>, AppError> {
    let folder = require_notes(&state)?;
    let result = match body.action.as_str() {
        "move_up" => notes::move_task(
            &folder,
            &body.path,
            body.line_index,
            "up",
            body.expected_text.as_deref(),
        )?,
        "move_down" => notes::move_task(
            &folder,
            &body.path,
            body.line_index,
            "down",
            body.expected_text.as_deref(),
        )?,
        "indent" => notes::indent_task(
            &folder,
            &body.path,
            body.line_index,
            body.expected_text.as_deref(),
        )?,
        "outdent" => notes::outdent_task(
            &folder,
            &body.path,
            body.line_index,
            body.expected_text.as_deref(),
        )?,
        "delete" => notes::delete_task(
            &folder,
            &body.path,
            body.line_index,
            body.expected_text.as_deref(),
        )?,
        _ => return Err(AppError::bad_request("Invalid action")),
    };
    Ok(Json(result))
}

async fn pick_notes_folder_endpoint(
    State(state): State<Arc<AppState>>,
    body: Option<Json<PickNotesFolderRequest>>,
) -> Result<Json<Value>, AppError> {
    let body = body.map(|j| j.0);
    let mut initial_dir = body
        .as_ref()
        .and_then(|b| b.initial_dir.clone())
        .filter(|s| !s.trim().is_empty());
    if initial_dir.is_none() {
        let path = state.config.read().notes_folder_path.clone();
        if !path.trim().is_empty() {
            initial_dir = Some(path);
        }
    }
    let title = body.as_ref().and_then(|b| b.title.clone());
    let folder = notes::pick_notes_folder(initial_dir.as_deref(), title.as_deref())?;
    match folder {
        None => Ok(Json(json!({ "cancelled": true, "folderPath": "" }))),
        Some(path) => {
            let normalized = notes::normalize_notes_root(&path)?;
            Ok(Json(json!({
                "cancelled": false,
                "folderPath": normalized.to_string_lossy(),
            })))
        }
    }
}

async fn prompt_text_endpoint(
    Json(body): Json<PromptTextRequest>,
) -> Result<Json<Value>, AppError> {
    match notes::prompt_text(&body.title, &body.prompt, &body.initial_value)? {
        None => Ok(Json(json!({ "cancelled": true, "value": "" }))),
        Some(value) => Ok(Json(json!({ "cancelled": false, "value": value }))),
    }
}

async fn open_note_file_endpoint(
    State(state): State<Arc<AppState>>,
    Json(body): Json<OpenNoteFileRequest>,
) -> Result<Json<Value>, AppError> {
    let folder = require_notes(&state)?;
    notes::open_note_file_externally(&folder, &body.path)?;
    Ok(Json(json!({ "status": "ok" })))
}

async fn system_metrics_endpoint() -> Json<Value> {
    Json(system_monitor::get_system_metrics())
}

async fn now_playing_endpoint() -> Json<Value> {
    Json(now_playing::get_now_playing())
}

async fn media_control_endpoint(Json(body): Json<MediaControlRequest>) -> Json<Value> {
    let ok = now_playing::media_control(&body.action);
    Json(json!({
        "status": if ok { "ok" } else { "failed" },
        "ok": ok,
    }))
}

async fn open_url_endpoint(Json(body): Json<OpenUrlRequest>) -> Result<Json<Value>, AppError> {
    let url = body.url.trim();
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(AppError::bad_request("Only http/https URLs are allowed"));
    }
    open::that(url).map_err(|e| AppError::internal(e.to_string()))?;
    Ok(Json(json!({ "status": "ok" })))
}

pub async fn serve(state: Arc<AppState>) -> anyhow::Result<()> {
    let (host, port) = {
        let cfg = state.config.read();
        (cfg.host.clone(), cfg.port)
    };
    let app = router(state);
    let listener = tokio::net::TcpListener::bind(format!("{host}:{port}")).await?;
    tracing::info!("Starting sync service on http://{host}:{port}");
    axum::serve(listener, app).await?;
    Ok(())
}
