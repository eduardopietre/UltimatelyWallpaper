#![cfg_attr(windows, windows_subsystem = "windows")]

mod api;
mod cache;
mod caldav;
mod config;
mod error;
mod models;
mod notes;
mod now_playing;
mod process_win;
mod sync_job;
mod system_monitor;
mod tray;
mod ui_state;

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use tracing_subscriber::EnvFilter;

use crate::config::Config;
use crate::sync_job::{sync_loop, AppState};

fn base_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Prefer crate root when running from target/release
            if dir.ends_with("release") || dir.ends_with("debug") {
                if let Some(target) = dir.parent() {
                    if let Some(crate_root) = target.parent() {
                        return crate_root.to_path_buf();
                    }
                }
            }
            return dir.to_path_buf();
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn configure_logging(base: &PathBuf) {
    let log_dir = base.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);

    let cutoff = SystemTime::now() - Duration::from_secs(7 * 24 * 3600);
    if let Ok(entries) = std::fs::read_dir(&log_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Ok(meta) = entry.metadata() {
                if let Ok(modified) = meta.modified() {
                    if modified < cutoff {
                        let _ = std::fs::remove_file(path);
                    }
                }
            }
        }
    }

    let file_appender = tracing_appender::rolling::daily(&log_dir, "sync-service.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    // Leak guard so it lives for process lifetime
    std::mem::forget(guard);

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(non_blocking)
        .with_ansi(false)
        .init();
}

fn main() -> anyhow::Result<()> {
    let base = base_dir();
    let _ = std::env::set_current_dir(&base);
    configure_logging(&base);

    tracing::info!("Sync service initialization started");
    let config = Config::load(base)?;
    let state = AppState::new(config);

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;

    let server_state = state.clone();
    let sync_state = state.clone();
    runtime.spawn(async move {
        if let Err(err) = api::serve(server_state).await {
            tracing::error!("HTTP server failed: {err}");
            tray::request_exit();
        }
    });
    runtime.spawn(async move {
        sync_loop(sync_state).await;
    });

    tracing::info!("Sync service ready");

    // Show tray immediately (faster than Python wait-for-health)
    if let Err(err) = tray::run_tray(state.clone()) {
        tracing::error!("Tray failed: {err}");
        // Fall back to blocking on server if tray unavailable
        while !tray::exit_requested() {
            std::thread::sleep(Duration::from_secs(1));
        }
    }

    state.shutdown.notify_waiters();
    tracing::info!("Sync service shutdown completed");
    Ok(())
}
