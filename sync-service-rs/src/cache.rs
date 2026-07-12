use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde_json::Value;

use crate::models::{CacheMetadata, SyncPayload};

pub struct EventCache {
    pub directory: PathBuf,
    events_path: PathBuf,
    metadata_path: PathBuf,
}

impl EventCache {
    pub fn new(directory: impl AsRef<Path>) -> Self {
        let directory = directory.as_ref().to_path_buf();
        let _ = fs::create_dir_all(&directory);
        Self {
            events_path: directory.join("events.json"),
            metadata_path: directory.join("metadata.json"),
            directory,
        }
    }

    pub fn write(&self, payload: &SyncPayload) -> anyhow::Result<()> {
        let data = serde_json::json!({
            "updatedAt": payload.updated_at,
            "calendars": payload.calendars,
            "events": payload.events,
        });
        let tmp_events = self.events_path.with_extension("tmp");
        let tmp_meta = self.metadata_path.with_extension("tmp");

        fs::write(&tmp_events, serde_json::to_string_pretty(&data)?)?;

        let metadata = CacheMetadata {
            updated_at: payload.updated_at.clone(),
            event_count: payload.events.len(),
            calendar_count: payload.calendars.len(),
        };
        fs::write(
            &tmp_meta,
            serde_json::to_string_pretty(&serde_json::json!({
                "updatedAt": metadata.updated_at,
                "eventCount": metadata.event_count,
                "calendarCount": metadata.calendar_count,
            }))?,
        )?;

        fs::rename(&tmp_events, &self.events_path)?;
        fs::rename(&tmp_meta, &self.metadata_path)?;
        Ok(())
    }

    pub fn read(&self) -> Option<Value> {
        let text = fs::read_to_string(&self.events_path).ok()?;
        serde_json::from_str(&text).ok()
    }

    pub fn metadata(&self) -> Option<Value> {
        let text = fs::read_to_string(&self.metadata_path).ok()?;
        serde_json::from_str(&text).ok()
    }

    pub fn utc_now_iso() -> String {
        Utc::now()
            .format("%Y-%m-%dT%H:%M:%S+00:00")
            .to_string()
    }
}

pub fn parse_iso_datetime(value: &str) -> anyhow::Result<DateTime<Utc>> {
    let normalized = value.replace('Z', "+00:00");
    if let Ok(dt) = DateTime::parse_from_rfc3339(&normalized) {
        return Ok(dt.with_timezone(&Utc));
    }
    // Fallback without offset
    let naive = chrono::NaiveDateTime::parse_from_str(&normalized[..19.min(normalized.len())], "%Y-%m-%dT%H:%M:%S")?;
    Ok(DateTime::from_naive_utc_and_offset(naive, Utc))
}
