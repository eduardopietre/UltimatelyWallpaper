use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarInfo {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventInfo {
    pub id: String,
    pub title: String,
    pub start: String,
    pub end: String,
    pub all_day: bool,
    pub location: String,
    pub calendar: String,
    pub calendar_id: String,
    pub uid: String,
    pub description: String,
    pub url: String,
    pub is_recurring: bool,
    pub recurrence_id: String,
    pub calendar_color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPayload {
    pub updated_at: String,
    pub calendars: Vec<CalendarInfo>,
    pub events: Vec<EventInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheMetadata {
    pub updated_at: String,
    pub event_count: usize,
    pub calendar_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsRequest {
    pub apple_id: String,
    pub app_password: Option<String>,
    pub sync_interval_minutes: u64,
    #[serde(default)]
    pub notes_enabled: bool,
    pub notes_folder_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<&'static str>,
    pub apple_id: String,
    pub sync_interval_minutes: u64,
    pub has_app_password: bool,
    pub notes_enabled: bool,
    pub notes_folder_path: String,
}

#[derive(Debug, Deserialize)]
pub struct UiStateUpdateRequest {
    #[serde(default)]
    pub values: std::collections::HashMap<String, String>,
}

#[derive(Debug, Serialize)]
pub struct UiStateResponse {
    pub values: std::collections::HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateEventRequest {
    pub title: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub all_day: bool,
    pub start: String,
    pub end: String,
    #[serde(default = "default_never")]
    pub repeat: String,
    #[serde(default = "default_none")]
    pub alert: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub notes: String,
    pub calendar_id: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEventRequest {
    pub calendar_id: String,
    pub uid: String,
    pub title: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub all_day: bool,
    pub start: String,
    pub end: String,
    #[serde(default = "default_never")]
    pub repeat: String,
    #[serde(default = "default_none")]
    pub alert: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub recurrence_id: String,
    #[serde(default = "default_series")]
    pub scope: String,
}

#[derive(Debug, Deserialize)]
pub struct DeleteEventRequest {
    pub calendar_id: String,
    pub uid: String,
    #[serde(default)]
    pub recurrence_id: String,
    #[serde(default = "default_series")]
    pub scope: String,
}

fn default_never() -> String {
    "never".into()
}
fn default_none() -> String {
    "none".into()
}
fn default_series() -> String {
    "series".into()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleNoteTaskRequest {
    pub path: String,
    pub line_index: usize,
    pub checked: bool,
    pub expected_text: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickNotesFolderRequest {
    pub initial_dir: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTextRequest {
    pub title: String,
    pub prompt: String,
    #[serde(default)]
    pub initial_value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddNoteTaskRequest {
    pub path: String,
    pub text: String,
    pub after_line_index: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditNoteTaskRequest {
    pub path: String,
    pub line_index: usize,
    pub text: String,
    pub expected_text: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddSubtaskRequest {
    pub path: String,
    pub parent_line_index: usize,
    pub text: String,
    pub expected_text: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteTaskActionRequest {
    pub path: String,
    pub line_index: usize,
    pub action: String,
    pub expected_text: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OpenNoteFileRequest {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct OpenUrlRequest {
    pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct MediaControlRequest {
    pub action: String,
}
