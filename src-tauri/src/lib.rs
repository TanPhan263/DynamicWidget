mod actions;
mod commands;
mod controls;
mod core;
mod errors;
mod i18n;
mod platform;
mod quick_actions;
mod state;
mod tray;

use std::sync::Arc;

use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

use crate::core::pairing::TokenStore;
use crate::core::settings_service::{Settings, SettingsStore};
use crate::core::{island, market, system_monitor};
use crate::state::AppState;

const LOG_MAX_BYTES: u128 = 1024 * 1024;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::LogDir {
                        file_name: Some("lintel".into()),
                    }),
                    Target::new(TargetKind::Stdout),
                ])
                .level(log::LevelFilter::Info)
                .max_file_size(LOG_MAX_BYTES)
                .rotation_strategy(RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let config_dir = app.path().app_config_dir()?;
            let store = SettingsStore::new(config_dir.clone());
            let loaded = store.load();
            for warning in &loaded.warnings {
                log::warn!("{warning}");
            }
            let state = Arc::new(AppState::new(
                store,
                loaded,
                TokenStore::new(config_dir),
                platform::create_adapter(),
            ));
            app.manage(state.clone());
            log::info!("Lintel {} starting", env!("CARGO_PKG_VERSION"));

            register_shortcut(&handle, &state);
            tray::create(&handle, &state.snapshot())?;
            actions::apply_api(&handle);
            island::spawn(handle.clone());
            system_monitor::spawn(handle.clone());
            market::spawn(handle.clone());

            if !state.read(|i| i.settings.onboarding_completed) {
                actions::open_settings(&handle);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::save_settings,
            commands::reset_settings,
            commands::complete_onboarding,
            commands::dismiss_error,
            commands::set_island_rect,
            commands::release_focus,
            commands::push_notification,
            commands::send_test_notification,
            commands::dismiss_notification,
            commands::clear_notifications,
            commands::set_do_not_disturb,
            commands::open_settings,
            commands::replace_browser_token,
            commands::open_extension_folder,
            commands::open_widget_app,
            commands::run_quick_action,
            commands::open_stock_page,
            commands::media_control,
            commands::get_weather,
            commands::get_background_image,
            commands::set_background_image,
            commands::get_controls,
            commands::set_control,
            commands::set_ui_language,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Lintel");

    app.run(|app, event| match event {
        // Keep running in the tray when windows close; only explicit Quit
        // (which passes an exit code) ends the process.
        RunEvent::ExitRequested {
            api, code: None, ..
        } => api.prevent_exit(),
        RunEvent::Exit => {
            if let Some(st) = app.try_state::<Arc<AppState>>() {
                st.mutate(|i| i.quitting = true);
            }
        }
        _ => {}
    });
}

/// Registers the saved shortcut. If another app holds it, falls back to the
/// default so there is always a keyboard path, and reports the conflict.
fn register_shortcut(app: &tauri::AppHandle, state: &AppState) {
    let saved = state.read(|i| i.settings.toggle_shortcut.clone());
    let mut service = state.shortcuts.lock().unwrap_or_else(|e| e.into_inner());
    let Err(e) = service.apply(app, &saved, actions::toggle_island) else {
        return;
    };
    log::warn!("saved shortcut unavailable: {e}");
    let default = Settings::default().toggle_shortcut;
    let fallback_ok =
        saved != default && service.apply(app, &default, actions::toggle_island).is_ok();
    let message = if fallback_ok {
        format!("{e}. The default shortcut is active instead.")
    } else {
        format!("{e}. Use the menu-bar/tray icon to open the island.")
    };
    state.mutate(|i| i.last_error = Some(message.clone()));
    let _ = app.emit(actions::SHORTCUT_CONFLICT, message);
}
