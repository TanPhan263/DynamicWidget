use std::collections::BTreeMap;
use std::sync::{Mutex, MutexGuard};
use std::time::Instant;

use serde::Serialize;

use crate::core::geometry::Rect;
use crate::core::http_api::{ApiServer, ApiStatus};
use crate::core::island::IslandLayout;
use crate::core::market::QuoteState;
use crate::core::media::{MediaCommand, NowPlaying};
use crate::core::notifications::{Notification, NotificationCenter};
use crate::core::pairing::TokenStore;
use crate::core::settings_service::{LoadOutcome, Settings, SettingsStore};
use crate::core::shortcut_service::ShortcutService;
use crate::core::system_monitor::SystemStats;
use crate::platform::{platform_name, PlatformAdapter};
use crate::quick_actions::{KeepAwake, Recorder};

/// Mutable core state. Guarded by [`AppState::inner`]. Rule: never call a
/// Tauri API that waits on the main thread (window or monitor queries,
/// shortcut registration, menu building) while holding this lock.
pub struct Inner {
    pub settings: Settings,
    pub notifications: NotificationCenter,
    pub stats: SystemStats,
    pub layout: IslandLayout,
    /// The area the island covers, in the island window's CSS pixels.
    pub island_rect: Option<Rect>,
    /// Hidden from the tray menu; not persisted.
    pub island_hidden: bool,
    /// The shortcut or tray asked for the island, so it shows over a
    /// full-screen app until full screen ends.
    pub island_summoned: bool,
    /// The app that had focus before the pointer reached the island, so
    /// focus can go back to it when the island closes.
    pub previous_foreground: Option<i64>,
    pub last_error: Option<String>,
    pub warnings: Vec<String>,
    pub quitting: bool,
    /// Pairs the browser extension with the API; empty if none could be made.
    pub browser_token: String,
    /// What a website last said it plays, and when.
    pub web_media: Option<(Option<NowPlaying>, Instant)>,
    /// A button press waiting for the extension to collect, and when.
    pub web_command: Option<(MediaCommand, Instant)>,
    /// Latest quotes by symbol, including symbols no longer followed.
    pub quotes: BTreeMap<String, QuoteState>,
    /// The language the pages show, for the tray and system notifications.
    pub ui_language: &'static str,
}

impl Inner {
    /// Quotes for the followed symbols, in the order the person chose.
    pub fn quote_list(&self) -> Vec<QuoteState> {
        self.settings
            .stocks
            .iter()
            .map(|s| {
                self.quotes
                    .get(s)
                    .cloned()
                    .unwrap_or_else(|| QuoteState::empty(s.clone()))
            })
            .collect()
    }
}

pub struct AppState {
    inner: Mutex<Inner>,
    pub adapter: Box<dyn PlatformAdapter>,
    pub store: SettingsStore,
    /// Serializes shortcut (re)registration. Shortcut handlers never lock it.
    pub shortcuts: Mutex<ShortcutService>,
    /// Starting and stopping binds sockets and joins a thread, so it has its
    /// own lock instead of living in [`Inner`].
    pub api: Mutex<ApiServer>,
    pub keep_awake: Mutex<KeepAwake>,
    pub recorder: Mutex<Recorder>,
}

/// Everything the island and Settings pages need in one response.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSnapshot {
    pub settings: Settings,
    pub notifications: Vec<Notification>,
    pub stats: SystemStats,
    pub layout: IslandLayout,
    pub api: ApiStatus,
    pub island_hidden: bool,
    pub last_error: Option<String>,
    pub warnings: Vec<String>,
    pub platform: &'static str,
    pub version: &'static str,
    pub settings_path: String,
    /// The Quick actions widget's Keep awake toggle.
    pub keep_awake: bool,
    /// When the running screen recording started, in Unix milliseconds.
    pub recording_since: Option<u64>,
    pub quotes: Vec<QuoteState>,
    /// For the tray menu; the pages pick their own language.
    #[serde(skip)]
    pub ui_language: &'static str,
}

impl AppState {
    pub fn new(
        store: SettingsStore,
        loaded: LoadOutcome,
        tokens: TokenStore,
        adapter: Box<dyn PlatformAdapter>,
    ) -> Self {
        let mut warnings = loaded.warnings;
        let browser_token = tokens.load_or_create().unwrap_or_else(|e| {
            warnings.push(format!(
                "The browser pairing token could not be saved ({e})"
            ));
            String::new()
        });
        Self {
            inner: Mutex::new(Inner {
                settings: loaded.settings,
                notifications: NotificationCenter::default(),
                stats: SystemStats::default(),
                layout: IslandLayout::initial(),
                island_rect: None,
                island_hidden: false,
                island_summoned: false,
                previous_foreground: None,
                last_error: None,
                warnings,
                quitting: false,
                browser_token,
                quotes: BTreeMap::new(),
                web_media: None,
                web_command: None,
                ui_language: "en",
            }),
            adapter,
            store,
            shortcuts: Mutex::new(ShortcutService::default()),
            api: Mutex::new(ApiServer::default()),
            keep_awake: Mutex::new(KeepAwake::default()),
            recorder: Mutex::new(Recorder::default()),
        }
    }

    pub fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn mutate<T>(&self, f: impl FnOnce(&mut Inner) -> T) -> T {
        f(&mut self.lock())
    }

    pub fn read<T>(&self, f: impl FnOnce(&Inner) -> T) -> T {
        f(&self.lock())
    }

    pub fn api_status(&self) -> ApiStatus {
        self.api.lock().unwrap_or_else(|e| e.into_inner()).status()
    }

    pub fn snapshot(&self) -> UiSnapshot {
        let api = self.api_status();
        let keep_awake = self
            .keep_awake
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_on();
        let recording_since = self
            .recorder
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .since();
        let g = self.lock();
        UiSnapshot {
            settings: g.settings.clone(),
            notifications: g.notifications.list(),
            stats: g.stats.clone(),
            layout: g.layout.clone(),
            api,
            island_hidden: g.island_hidden,
            last_error: g.last_error.clone(),
            warnings: g.warnings.clone(),
            platform: platform_name(),
            version: env!("CARGO_PKG_VERSION"),
            settings_path: self.store.path().to_string_lossy().into_owned(),
            keep_awake,
            recording_since,
            quotes: g.quote_list(),
            ui_language: g.ui_language,
        }
    }
}
