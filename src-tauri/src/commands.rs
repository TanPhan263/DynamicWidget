//! IPC commands for the island and Settings pages. Commands are async so
//! they run off the main thread and may call Tauri APIs that wait on it.

use tauri::{AppHandle, Emitter};
use tauri_plugin_autostart::ManagerExt;

use crate::actions::{self, SHORTCUT_CONFLICT};
use crate::core::background;
use crate::core::geometry::Rect;
use crate::core::island::{MAX_WINDOW_HEIGHT, WINDOW_WIDTH};
use crate::core::market;
use crate::core::media::MediaCommand;
use crate::core::notifications::{Notification, NotificationInput, NotificationSource, Symbol};
use crate::core::settings_service::{self, Settings, WidgetId};
use crate::core::shortcut_service;
use crate::errors::{AppError, AppResult};
use crate::quick_actions::{self, QuickAction};
use crate::state::UiSnapshot;

#[tauri::command]
pub async fn get_snapshot(app: AppHandle) -> AppResult<UiSnapshot> {
    Ok(actions::state(&app).snapshot())
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: Settings) -> AppResult<UiSnapshot> {
    apply_settings(&app, settings)?;
    Ok(actions::state(&app).snapshot())
}

#[tauri::command]
pub async fn replace_browser_token(app: AppHandle) -> AppResult<UiSnapshot> {
    actions::replace_browser_token(&app)?;
    Ok(actions::state(&app).snapshot())
}

/// Returns the new state of a toggle, when it is known.
#[tauri::command]
pub async fn run_quick_action(app: AppHandle, action: QuickAction) -> AppResult<Option<bool>> {
    quick_actions::run(&app, action)
}

/// Plays, pauses or skips on the player the Now playing widget shows.
#[tauri::command]
pub async fn media_control(
    app: AppHandle,
    player: String,
    command: MediaCommand,
    browser: bool,
) -> AppResult<()> {
    let st = actions::state(&app);
    if browser {
        // The extension collects it within a second or so.
        st.mutate(|i| i.web_command = Some((command, std::time::Instant::now())));
        return Ok(());
    }
    st.adapter.media_control(&player, command)
}

/// Opens a symbol's quote page on Yahoo Finance.
/// Blocks on the network at most every 15 minutes; async commands run off the main thread.
#[tauri::command]
pub async fn get_weather(app: AppHandle) -> AppResult<crate::core::weather::Weather> {
    let lang = actions::state(&app).read(|i| i.ui_language);
    crate::core::weather::current(lang)
}

#[tauri::command]
pub async fn open_stock_page(symbol: String) -> AppResult<()> {
    let symbol = market::normalize_symbol(&symbol)
        .ok_or_else(|| AppError::Validation(format!("\"{symbol}\" is not a ticker symbol")))?;
    actions::open_with_system(format!(
        "https://finance.yahoo.com/quote/{}",
        market::url_symbol(&symbol)
    ))
}

#[tauri::command]
pub async fn open_widget_app(widget: WidgetId) -> AppResult<()> {
    actions::open_widget_app(widget)
}

/// Opens the browser extension's folder so it can be loaded into the
/// browser, and returns its path.
#[tauri::command]
pub async fn open_extension_folder(app: AppHandle) -> AppResult<String> {
    let dir = actions::extension_dir(&app)
        .ok_or_else(|| AppError::Platform("the browser extension folder is missing".into()))?;
    actions::open_with_system(&dir)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn reset_settings(app: AppHandle) -> AppResult<UiSnapshot> {
    let defaults = Settings {
        onboarding_completed: true,
        ..Settings::default()
    };
    apply_settings(&app, defaults)?;
    Ok(actions::state(&app).snapshot())
}

#[tauri::command]
pub async fn complete_onboarding(app: AppHandle) -> AppResult<UiSnapshot> {
    let st = actions::state(&app);
    let current = st.read(|i| i.settings.clone());
    apply_settings(
        &app,
        Settings {
            onboarding_completed: true,
            ..current
        },
    )?;
    Ok(st.snapshot())
}

#[tauri::command]
pub async fn dismiss_error(app: AppHandle) -> AppResult<UiSnapshot> {
    let st = actions::state(&app);
    st.mutate(|i| {
        i.last_error = None;
        i.warnings.clear();
    });
    Ok(st.snapshot())
}

/// Sent as `{ slot, image }` (image is a data URL or null) when a background picture changes.
pub const BACKGROUND_CHANGED: &str = "background-changed";

#[derive(Clone, serde::Serialize)]
struct BackgroundChanged {
    slot: background::Slot,
    image: Option<String>,
}

fn background_file(app: &AppHandle, slot: background::Slot) -> std::path::PathBuf {
    let settings = actions::state(app).store.path();
    background::path(settings.parent().unwrap_or(std::path::Path::new(".")), slot)
}

/// A background picture as a data URL, if one is saved for `slot`.
#[tauri::command]
pub async fn get_background_image(
    app: AppHandle,
    slot: background::Slot,
) -> AppResult<Option<String>> {
    Ok(background::load(&background_file(&app, slot)))
}

/// Saves a picture (a JPEG or PNG data URL) as the background for `slot`, or removes it.
#[tauri::command]
pub async fn set_background_image(
    app: AppHandle,
    slot: background::Slot,
    image: Option<String>,
) -> AppResult<()> {
    let bytes = image.as_deref().map(background::decode).transpose()?;
    let file = background_file(&app, slot);
    background::save(&file, bytes.as_deref())?;
    let image = background::load(&file);
    let _ = app.emit(BACKGROUND_CHANGED, BackgroundChanged { slot, image });
    Ok(())
}

/// What the Controls widget shows: Wi-Fi, Bluetooth, volume and the rest.
#[tauri::command]
pub async fn get_controls() -> crate::controls::Controls {
    crate::controls::read()
}

/// Switches one control and returns them all as they are afterwards.
#[tauri::command]
pub async fn set_control(change: crate::controls::Change) -> AppResult<crate::controls::Controls> {
    crate::controls::set(change)
}

/// The pages say which language they show; the tray and system
/// notifications follow it.
#[tauri::command]
pub async fn set_ui_language(app: AppHandle, language: String) -> AppResult<()> {
    let lang = crate::i18n::language(&language);
    actions::state(&app).mutate(|i| i.ui_language = lang);
    actions::notify_ui(&app);
    Ok(())
}

/// The island page reports the area it covers whenever its shape changes.
#[tauri::command]
pub async fn set_island_rect(app: AppHandle, rect: Rect) -> AppResult<()> {
    let finite = [rect.x, rect.y, rect.width, rect.height]
        .iter()
        .all(|v| v.is_finite());
    if !finite || rect.width < 0.0 || rect.height < 0.0 {
        return Err(AppError::Validation("Island rectangle is invalid".into()));
    }
    let clamped = Rect::new(
        rect.x.clamp(0.0, WINDOW_WIDTH),
        rect.y.clamp(0.0, MAX_WINDOW_HEIGHT),
        rect.width.min(WINDOW_WIDTH),
        rect.height.min(MAX_WINDOW_HEIGHT),
    );
    actions::state(&app).mutate(|i| i.island_rect = Some(clamped));
    Ok(())
}

/// Called by the island when it closes while focused.
#[tauri::command]
pub async fn release_focus(app: AppHandle) -> AppResult<()> {
    actions::release_focus(&app);
    Ok(())
}

/// Notifications raised by island widgets, such as the timer.
#[tauri::command]
pub async fn push_notification(
    app: AppHandle,
    input: NotificationInput,
    symbol: Option<Symbol>,
) -> AppResult<Notification> {
    actions::push_notification(&app, input, symbol, NotificationSource::Widget)
}

#[tauri::command]
pub async fn send_test_notification(app: AppHandle) -> AppResult<Notification> {
    actions::send_test_notification(&app)
}

#[tauri::command]
pub async fn dismiss_notification(app: AppHandle, id: u64) -> AppResult<()> {
    actions::dismiss_notification(&app, id);
    Ok(())
}

#[tauri::command]
pub async fn clear_notifications(app: AppHandle) -> AppResult<()> {
    actions::clear_notifications(&app);
    Ok(())
}

#[tauri::command]
pub async fn set_do_not_disturb(app: AppHandle, enabled: bool) -> AppResult<UiSnapshot> {
    actions::set_do_not_disturb(&app, enabled);
    Ok(actions::state(&app).snapshot())
}

#[tauri::command]
pub async fn open_settings(app: AppHandle) -> AppResult<()> {
    actions::open_settings(&app);
    Ok(())
}

/// Validates and applies a full settings document: shortcut, start at
/// login, the API server and persistence. Side effects that fail are rolled
/// back so the stored settings always match what is active.
fn apply_settings(app: &AppHandle, input: Settings) -> AppResult<()> {
    let st = actions::state(app);
    let next = settings_service::validate(input)?;
    shortcut_service::parse(&next.toggle_shortcut)?;
    let prev = st.read(|i| i.settings.clone());

    let shortcut_changed = prev.toggle_shortcut != next.toggle_shortcut;
    if shortcut_changed {
        let mut service = st.shortcuts.lock().unwrap_or_else(|e| e.into_inner());
        if let Err(e) = service.apply(app, &next.toggle_shortcut, actions::toggle_island) {
            let _ = app.emit(SHORTCUT_CONFLICT, e.to_string());
            return Err(e);
        }
    }

    if prev.start_at_login != next.start_at_login {
        let autolaunch = app.autolaunch();
        let result = if next.start_at_login {
            autolaunch.enable()
        } else {
            autolaunch.disable()
        };
        if let Err(e) = result {
            if shortcut_changed {
                let mut service = st.shortcuts.lock().unwrap_or_else(|e| e.into_inner());
                let _ = service.apply(app, &prev.toggle_shortcut, actions::toggle_island);
            }
            return Err(AppError::Autostart(e.to_string()));
        }
        log::info!(
            "start at login {}",
            if next.start_at_login {
                "enabled"
            } else {
                "disabled"
            }
        );
    }

    st.store.save(&next)?;
    let api_changed = prev.api_enabled != next.api_enabled || prev.api_port != next.api_port;
    st.mutate(|i| {
        i.settings = next;
        // A successful save clears a stale shortcut or storage error.
        i.last_error = None;
    });
    if api_changed {
        actions::apply_api(app);
    }
    actions::emit_settings(app);
    actions::notify_ui(app);
    Ok(())
}
