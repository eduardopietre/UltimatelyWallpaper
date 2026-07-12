use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug)]
pub struct AppError {
    pub status: StatusCode,
    pub detail: String,
}

impl AppError {
    pub fn new(status: StatusCode, detail: impl Into<String>) -> Self {
        Self {
            status,
            detail: detail.into(),
        }
    }

    pub fn bad_request(detail: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, detail)
    }

    pub fn not_found(detail: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, detail)
    }

    pub fn conflict(detail: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, detail)
    }

    pub fn internal(detail: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, detail)
    }

    pub fn not_implemented(detail: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_IMPLEMENTED, detail)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "detail": self.detail }))).into_response()
    }
}

pub fn friendly_sync_error(err: &anyhow::Error) -> String {
    let message = err.to_string();
    if message.contains("APPLE_ID") || message.contains("APP_PASSWORD") {
        return "Calendar credentials not configured".into();
    }
    let lower = message.to_ascii_lowercase();
    if lower.contains("timed out") || lower.contains("timeout") {
        return "Connection timed out".into();
    }
    if lower.contains("unauthorized")
        || lower.contains("forbidden")
        || lower.contains("401")
        || lower.contains("403")
    {
        return "Authentication failed".into();
    }
    if lower.contains("connection") || lower.contains("connect") || lower.contains("network") {
        return "Could not reach calendar server".into();
    }
    if err.downcast_ref::<std::io::Error>().is_some() {
        return "Calendar sync failed".into();
    }
    if message.len() < 120 && !message.is_empty() {
        // Keep short ValueError-style messages
        if !lower.contains("error") || message.starts_with("Calendar") {
            return message;
        }
    }
    "Calendar sync failed".into()
}
