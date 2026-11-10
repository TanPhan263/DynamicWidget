//! User intents shared by the tray, the global shortcut, the HTTP API and
//! IPC commands. Each action mutates core state under the lock, then
//! notifies the pages and the tray after the lock is released.

use crate::i18n::{text, Text};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use crate::core::http_api::{CommandSource, MediaSink, Sink, TokenSource};
use crate::core::island::ISLAND_LABEL;
use crate::core::notifications::{
    now_ms, Notification, NotificationInput, NotificationSource, Symbol,
};
use crate::core::settings_service::{Settings, WidgetId};
use crate::errors::{AppError, AppResult};
use crate::state::{AppState, Inner};
use crate::tray;

/// A new notification arrived; the island may pop open to show it.
pub const NOTIFICATION: &str = "notification";
pub const NOTIFICATIONS_CHANGED: &str = "notifications-changed";
pub const SETTINGS_CHANGED: &str = "settings-changed";
/// Anything else in the snapshot changed (API status, hidden island, errors).
pub const STATE_CHANGED: &str = "state-changed";
pub const SHORTCUT_CONFLICT: &str = "shortcut-conflict";
/// Open or close the island panel.
pub const ISLAND_TOGGLE: &str = "island-toggle";

pub fn state(app: &AppHandle) -> Arc<AppState> {
    app.state::<Arc<AppState>>().inner().clone()
}

/// Global shortcut and tray entry point: opens or closes the island panel
/// and gives it keyboard focus so Esc closes it again.
pub fn toggle_island(app: &AppHandle) {
    let st = state(app);
    if st.read(|i| i.island_hidden) {
        set_island_hidden(app, false);
    }
    if let Some(token) = st.adapter.foreground_token() {
        st.mutate(|i| i.previous_foreground = Some(token));
    }
    st.mutate(|i| i.island_summoned = true);
    crate::core::island::wake();
    if let Some(w) = app.get_webview_window(ISLAND_LABEL) {
        let _ = w.set_focus();
    }
    let _ = app.emit_to(ISLAND_LABEL, ISLAND_TOGGLE, ());
}

/// Returns focus to the app that had it before the island was used.
pub fn release_focus(app: &AppHandle) {
    let st = state(app);
    if let Some(token) = st.mutate(|i| i.previous_foreground.take()) {
        st.adapter.restore_foreground(app, token);
    }
}

pub fn push_notification(
    app: &AppHandle,
    input: NotificationInput,
    symbol: Option<Symbol>,
    source: NotificationSource,
) -> AppResult<Notification> {
    let st = state(app);
    let (n, list) = st.mutate(|i| {
        let n = i.notifications.push(input, symbol, source, now_ms())?;
        AppResult::Ok((n, i.notifications.list()))
    })?;
    log::info!("notification #{} from {:?}", n.id, source);
    let _ = app.emit(NOTIFICATION, &n);
    let _ = app.emit(NOTIFICATIONS_CHANGED, &list);
    Ok(n)
}

pub fn send_test_notification(app: &AppHandle) -> AppResult<Notification> {
    let lang = state(app).read(|i| i.ui_language);
    push_notification(
        app,
        NotificationInput {
            title: text(lang, Text::TestTitle).into(),
            body: Some(text(lang, Text::TestBody).into()),
            app: Some("Lintel".into()),
            icon: None,
            accent: Some("#171717".into()),
            image: None,
        },
        Some(Symbol::Sparkles),
        NotificationSource::System,
    )
}

pub fn dismiss_notification(app: &AppHandle, id: u64) {
    let list = state(app).mutate(|i| {
        i.notifications.dismiss(id);
        i.notifications.list()
    });
    let _ = app.emit(NOTIFICATIONS_CHANGED, &list);
}

pub fn clear_notifications(app: &AppHandle) {
    state(app).mutate(|i| i.notifications.clear());
    let _ = app.emit(NOTIFICATIONS_CHANGED, Vec::<Notification>::new());
}

pub fn set_do_not_disturb(app: &AppHandle, enabled: bool) {
    let st = state(app);
    st.mutate(|i| {
        i.settings.do_not_disturb = enabled;
        persist(&st, i);
    });
    emit_settings(app);
    notify_ui(app);
}

pub fn set_island_hidden(app: &AppHandle, hidden: bool) {
    state(app).mutate(|i| i.island_hidden = hidden);
    crate::core::island::wake();
    notify_ui(app);
}

/// The API server calls this for every accepted request.
pub fn api_sink(app: &AppHandle) -> Sink {
    let app = app.clone();
    Arc::new(move |input, source| push_notification(&app, input, None, source))
}

/// Keeps what the browser reports playing; the system monitor shows it.
fn media_sink(app: &AppHandle) -> MediaSink {
    let app = app.clone();
    // The extension repeats reports while playing; log only changes.
    let last = std::sync::Mutex::new(String::new());
    Arc::new(move |input| {
        let seen = format!(
            "playing={} app={:?} title={:?} artist={:?}",
            input.playing, input.app, input.title, input.artist
        );
        if let Ok(mut last) = last.lock() {
            if *last != seen {
                log::info!("browser media: {seen}");
                *last = seen;
            }
        }
        let now_playing = input.now_playing()?;
        state(&app).mutate(|i| i.web_media = Some((now_playing, Instant::now())));
        Ok(())
    })
}

/// A press older than this is dropped, so a late pickup never surprises.
const WEB_COMMAND_FRESH: Duration = Duration::from_secs(10);

/// The extension collects a waiting play, pause or skip through this.
fn command_source(app: &AppHandle) -> CommandSource {
    let app = app.clone();
    Arc::new(move || {
        state(&app).mutate(|i| {
            i.web_command
                .take()
                .filter(|(_, at)| at.elapsed() < WEB_COMMAND_FRESH)
                .map(|(c, _)| c)
        })
    })
}

/// The API server reads the pairing token per request through this.
fn browser_token(app: &AppHandle) -> TokenSource {
    let app = app.clone();
    Arc::new(move || state(&app).read(|i| i.browser_token.clone()))
}

/// Makes a new pairing token, unpairing browsers that use the old one.
pub fn replace_browser_token(app: &AppHandle) -> AppResult<()> {
    let st = state(app);
    let token = st.tokens.replace()?;
    st.mutate(|i| i.browser_token = token);
    log::info!("browser pairing token replaced");
    notify_ui(app);
    Ok(())
}

/// The browser extension's folder: the source folder in development builds,
/// so edits load right away, and the bundled copy otherwise.
pub fn extension_dir(app: &AppHandle) -> Option<PathBuf> {
    let source =
        cfg!(debug_assertions).then(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../extension"));
    let bundled = app.path().resource_dir().ok().map(|d| d.join("extension"));
    [source, bundled]
        .into_iter()
        .flatten()
        .find(|d| d.join("manifest.json").is_file())
        .map(|d| d.canonicalize().unwrap_or(d))
}

/// Opens a folder in Finder or Explorer, or a web page in the default browser.
pub fn open_with_system(target: impl AsRef<OsStr>) -> AppResult<()> {
    let program = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    };
    let target = target.as_ref();
    std::process::Command::new(program)
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| {
            AppError::Platform(format!("could not open {}: {e}", target.to_string_lossy()))
        })
}

/// How the system app that matches a widget is started.
enum Launch {
    /// An app bundle, opened with `open`.
    MacApp(&'static str),
    /// A program on the PATH.
    Program(&'static str),
    /// A URI or shell folder, opened by Explorer.
    Explorer(&'static str),
}

/// The system app that goes with each widget, if this platform has one.
fn widget_app(widget: WidgetId) -> Option<Launch> {
    if cfg!(target_os = "macos") {
        Some(Launch::MacApp(match widget {
            WidgetId::Clock | WidgetId::Timer => "/System/Applications/Clock.app",
            WidgetId::Calendar => "/System/Applications/Calendar.app",
            WidgetId::System => "/System/Applications/Utilities/Activity Monitor.app",
            WidgetId::Notes => "/System/Applications/Notes.app",
            WidgetId::Weather => "/System/Applications/Weather.app",
            WidgetId::Actions | WidgetId::Stocks | WidgetId::Media | WidgetId::Controls => {
                return None
            }
        }))
    } else if cfg!(target_os = "windows") {
        Some(match widget {
            WidgetId::Clock | WidgetId::Timer => Launch::Explorer("ms-clock:"),
            WidgetId::Calendar => Launch::Explorer("outlookcal:"),
            WidgetId::System => Launch::Program("taskmgr"),
            WidgetId::Notes => Launch::Explorer(
                r"shell:AppsFolder\Microsoft.MicrosoftStickyNotes_8wekyb3d8bbwe!App",
            ),
            WidgetId::Weather => Launch::Explorer("msnweather:"),
            WidgetId::Actions | WidgetId::Stocks | WidgetId::Media | WidgetId::Controls => {
                return None
            }
        })
    } else {
        None
    }
}

/// Opens the system app that matches a widget, such as Calendar for the
/// calendar widget. The widget picks from a fixed list; the page never
/// names a program.
pub fn open_widget_app(widget: WidgetId) -> AppResult<()> {
    let launch = widget_app(widget)
        .ok_or_else(|| AppError::Platform("no app goes with this widget here".into()))?;
    let mut command = match launch {
        Launch::MacApp(path) => {
            // Clock only ships with macOS 13 and later.
            if !Path::new(path).exists() {
                return Err(AppError::Platform(format!("{path} is not installed")));
            }
            let mut c = std::process::Command::new("open");
            c.arg(path);
            c
        }
        Launch::Program(name) => std::process::Command::new(name),
        Launch::Explorer(target) => {
            let mut c = std::process::Command::new("explorer");
            c.arg(target);
            c
        }
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|e| AppError::Platform(format!("could not open the app for {widget:?}: {e}")))
}

/// Starts, stops or moves the API server to match the current settings.
/// A busy port is recorded as the last error instead of failing.
pub fn apply_api(app: &AppHandle) {
    let st = state(app);
    let (enabled, port) = st.read(|i| (i.settings.api_enabled, i.settings.api_port));
    let result = st.api.lock().unwrap_or_else(|e| e.into_inner()).apply(
        enabled,
        port,
        api_sink(app),
        media_sink(app),
        command_source(app),
        browser_token(app),
    );
    if let Err(e) = result {
        log::warn!("{e}");
        st.mutate(|i| i.last_error = Some(e.to_string()));
    }
    notify_ui(app);
}

pub fn open_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn quit(app: &AppHandle) {
    let st = state(app);
    st.mutate(|i| i.quitting = true);
    st.api.lock().unwrap_or_else(|e| e.into_inner()).stop();
    let _ = st
        .keep_awake
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .set(false);
    // Stopping lets the movie finish writing.
    let _ = st.recorder.lock().unwrap_or_else(|e| e.into_inner()).stop();
    log::info!("quit");
    app.exit(0);
}

/// Pushes the current state to the pages and the tray menu. Must be called
/// without holding the state lock.
pub fn notify_ui(app: &AppHandle) {
    let snap = state(app).snapshot();
    let _ = app.emit(STATE_CHANGED, ());
    tray::refresh(app, &snap);
}

pub fn emit_settings(app: &AppHandle) {
    let settings: Settings = state(app).read(|i| i.settings.clone());
    let _ = app.emit(SETTINGS_CHANGED, &settings);
}

/// Saves settings while the caller holds the lock. File I/O only, no Tauri
/// calls, so this is safe under the lock. Failures are surfaced as the last
/// error instead of aborting the user's action.
pub fn persist(st: &AppState, inner: &mut Inner) {
    if let Err(e) = st.store.save(&inner.settings) {
        log::error!("saving settings failed: {e}");
        inner.last_error = Some(format!("Settings could not be saved: {e}"));
    }
}
