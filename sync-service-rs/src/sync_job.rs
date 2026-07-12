use std::sync::Arc;
use std::time::Duration;

use parking_lot::RwLock;
use tokio::sync::Notify;
use tokio::time::{interval, MissedTickBehavior};

use crate::cache::EventCache;
use crate::caldav;
use crate::config::{Config, SharedConfig};
use crate::error::friendly_sync_error;

pub struct AppState {
    pub config: SharedConfig,
    pub cache: EventCache,
    pub last_sync_error: RwLock<Option<String>>,
    pub sync_interval_notify: Notify,
    pub shutdown: Notify,
}

impl AppState {
    pub fn new(config: Config) -> Arc<Self> {
        let cache = EventCache::new(&config.cache_dir);
        Arc::new(Self {
            cache,
            config: Arc::new(RwLock::new(config)),
            last_sync_error: RwLock::new(None),
            sync_interval_notify: Notify::new(),
            shutdown: Notify::new(),
        })
    }

    pub async fn run_sync(&self) -> Result<crate::models::SyncPayload, anyhow::Error> {
        let cfg = self.config.read().clone();
        match caldav::run_sync(&self.cache, &cfg).await {
            Ok(payload) => {
                *self.last_sync_error.write() = None;
                Ok(payload)
            }
            Err(err) => {
                let friendly = friendly_sync_error(&err);
                *self.last_sync_error.write() = Some(friendly.clone());
                Err(err)
            }
        }
    }
}

pub async fn sync_loop(state: Arc<AppState>) {
    // Initial sync
    if let Err(err) = state.run_sync().await {
        tracing::warn!("Initial sync failed: {err}");
    } else {
        tracing::info!("Initial sync completed successfully");
    }

    loop {
        let minutes = state.config.read().sync_interval_minutes.max(1);
        let mut ticker = interval(Duration::from_secs(minutes * 60));
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        ticker.tick().await; // skip immediate tick

        tokio::select! {
            _ = ticker.tick() => {
                if let Err(err) = state.run_sync().await {
                    tracing::error!("Sync failed: {err}");
                }
            }
            _ = state.sync_interval_notify.notified() => {
                // interval changed — restart loop with new period
                continue;
            }
            _ = state.shutdown.notified() => {
                break;
            }
        }
    }
}
