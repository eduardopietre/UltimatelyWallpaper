use std::collections::HashMap;
use std::fs;
use std::path::Path;

const ALLOWED_UI_STATE_KEYS: &[&str] = &[
    "calendarCollapsed",
    "calendarPosition",
    "calendarPositionLocked",
    "calendarSize",
    "notesCollapsed",
    "notesHideCompleted",
    "notesPosition",
    "notesPositionLocked",
    "notesSelectedFile",
    "notesSize",
    "wallpaperPrefs",
    "gadgetVisibility",
    "launcherPosition",
    "clockPosition",
    "clockSize",
    "clockPrefs",
    "pomodoroPosition",
    "pomodoroPrefs",
    "linksPosition",
    "linksSize",
    "linksData",
    "mediaPosition",
    "mediaSize",
    "monitorPosition",
    "monitorSize",
];

fn ui_state_path(cache_dir: &Path) -> std::path::PathBuf {
    cache_dir.join("ui-state.json")
}

fn is_allowed(key: &str) -> bool {
    ALLOWED_UI_STATE_KEYS.contains(&key)
}

pub fn read_ui_state(cache_dir: &Path) -> HashMap<String, String> {
    let path = ui_state_path(cache_dir);
    let Ok(text) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    let Ok(raw) = serde_json::from_str::<serde_json::Value>(&text) else {
        return HashMap::new();
    };
    let Some(obj) = raw.as_object() else {
        return HashMap::new();
    };

    let mut values = HashMap::new();
    for (key, value) in obj {
        if !is_allowed(key) || value.is_null() {
            continue;
        }
        let as_str = match value {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        values.insert(key.clone(), as_str);
    }
    values
}

pub fn merge_ui_state(
    cache_dir: &Path,
    updates: &HashMap<String, String>,
) -> anyhow::Result<HashMap<String, String>> {
    let mut current = read_ui_state(cache_dir);
    for (key, value) in updates {
        if !is_allowed(key) {
            continue;
        }
        current.insert(key.clone(), value.clone());
    }

    fs::create_dir_all(cache_dir)?;
    let path = ui_state_path(cache_dir);
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, serde_json::to_string_pretty(&current)?)?;
    fs::rename(tmp, path)?;
    Ok(current)
}
