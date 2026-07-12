use std::env;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::RwLock;

#[derive(Debug, Clone)]
pub struct Config {
    pub base_dir: PathBuf,
    pub env_path: PathBuf,
    pub host: String,
    pub port: u16,
    pub apple_id: String,
    pub app_password: String,
    pub sync_interval_minutes: u64,
    pub days_past: i64,
    pub days_future: i64,
    pub caldav_url: String,
    pub notes_enabled: bool,
    pub notes_folder_path: String,
    pub cache_dir: PathBuf,
}

impl Config {
    pub fn load(base_dir: PathBuf) -> anyhow::Result<Self> {
        let env_path = base_dir.join(".env");
        if env_path.exists() {
            // Prefer a lenient parser: paths may contain spaces, `~`, etc.
            let values = read_env_file(&env_path);
            apply_settings_to_environment(&values);
        }

        let host = normalize_host(env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into()));
        let port = env::var("PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(8765);
        let cache_dir_raw = env::var("CACHE_DIR").unwrap_or_else(|_| "cache".into());
        let cache_dir = if Path::new(&cache_dir_raw).is_absolute() {
            PathBuf::from(cache_dir_raw)
        } else {
            base_dir.join(cache_dir_raw)
        };

        Ok(Self {
            base_dir,
            env_path,
            host,
            port,
            apple_id: env::var("APPLE_ID").unwrap_or_default(),
            app_password: env::var("APP_PASSWORD").unwrap_or_default(),
            sync_interval_minutes: env::var("SYNC_INTERVAL_MINUTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(10)
                .max(1),
            days_past: env::var("DAYS_PAST")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(30),
            days_future: env::var("DAYS_FUTURE")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(180),
            caldav_url: env::var("CALDAV_URL")
                .unwrap_or_else(|_| "https://caldav.icloud.com/".into()),
            notes_enabled: notes_enabled_from_value(env::var("NOTES_ENABLED").ok().as_deref()),
            notes_folder_path: env::var("NOTES_FOLDER_PATH").unwrap_or_default(),
            cache_dir,
        })
    }

    pub fn reload_from_env(&mut self) {
        self.apple_id = env::var("APPLE_ID").unwrap_or_default();
        self.app_password = env::var("APP_PASSWORD").unwrap_or_default();
        self.sync_interval_minutes = env::var("SYNC_INTERVAL_MINUTES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(10)
            .max(1);
        self.notes_enabled = notes_enabled_from_value(env::var("NOTES_ENABLED").ok().as_deref());
        self.notes_folder_path = env::var("NOTES_FOLDER_PATH").unwrap_or_default();
        self.days_past = env::var("DAYS_PAST")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30);
        self.days_future = env::var("DAYS_FUTURE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(180);
        self.caldav_url =
            env::var("CALDAV_URL").unwrap_or_else(|_| "https://caldav.icloud.com/".into());
        if let Ok(host) = env::var("HOST") {
            self.host = normalize_host(host);
        }
        if let Ok(port) = env::var("PORT").and_then(|v| {
            v.parse()
                .map_err(|_| env::VarError::NotPresent)
        }) {
            self.port = port;
        }
    }
}

pub type SharedConfig = Arc<RwLock<Config>>;

pub fn normalize_host(host: String) -> String {
    let trimmed = host.trim();
    if trimmed.eq_ignore_ascii_case("localhost") {
        "127.0.0.1".into()
    } else {
        trimmed.to_string()
    }
}

pub fn notes_enabled_from_value(value: Option<&str>) -> bool {
    matches!(
        value.unwrap_or("").trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

pub fn read_env_file(path: &Path) -> std::collections::HashMap<String, String> {
    let mut values = std::collections::HashMap::new();
    let Ok(text) = std::fs::read_to_string(path) else {
        return values;
    };
    for line in text.lines() {
        let stripped = line.trim();
        if stripped.is_empty() || stripped.starts_with('#') || !stripped.contains('=') {
            continue;
        }
        let (key, value) = stripped.split_once('=').unwrap();
        let mut value = value.trim().to_string();
        if (value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\''))
        {
            value = value[1..value.len() - 1].to_string();
        }
        values.insert(key.trim().to_string(), value);
    }
    values
}

pub fn write_env_values(path: &Path, updates: &std::collections::HashMap<String, String>) -> anyhow::Result<()> {
    let existing = if path.exists() {
        std::fs::read_to_string(path)?
    } else {
        String::new()
    };
    let existing_lines: Vec<&str> = if existing.is_empty() {
        Vec::new()
    } else {
        existing.lines().collect()
    };

    let mut seen = std::collections::HashSet::new();
    let mut output: Vec<String> = Vec::new();

    for line in existing_lines {
        let stripped = line.trim();
        if stripped.is_empty() || stripped.starts_with('#') || !stripped.contains('=') {
            output.push(line.to_string());
            continue;
        }
        let key = line.split_once('=').unwrap().0.trim();
        if let Some(value) = updates.get(key) {
            output.push(format!("{key}={value}"));
            seen.insert(key.to_string());
        } else {
            output.push(line.to_string());
        }
    }

    for (key, value) in updates {
        if !seen.contains(key) {
            output.push(format!("{key}={value}"));
        }
    }

    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, output.join("\n") + "\n")?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

pub fn apply_settings_to_environment(updates: &std::collections::HashMap<String, String>) {
    for (key, value) in updates {
        // SAFETY: single-threaded settings update from API; process-local env.
        unsafe { env::set_var(key, value) };
    }
}
