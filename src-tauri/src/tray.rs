//! Menu-bar (macOS) / system-tray (Windows) icon and menu.

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Wry};

use crate::actions;
use crate::state::UiSnapshot;

const TRAY_ID: &str = "islet";

const ICON: &[u8] = include_bytes!("../icons/tray.png");
const ICON_DND: &[u8] = include_bytes!("../icons/tray-dnd.png");

fn icon(dnd: bool) -> Image<'static> {
    Image::from_bytes(if dnd { ICON_DND } else { ICON }).expect("bundled tray icon is a valid PNG")
}

fn tooltip(snap: &UiSnapshot) -> String {
    if snap.settings.do_not_disturb {
        "Islet: Do Not Disturb".into()
    } else {
        "Islet".into()
    }
}

/// "CommandOrControl+Shift+Space" → "⌘⇧Space" on macOS, "Ctrl+Shift+Space"
/// elsewhere. Only used for menu labels.
pub fn shortcut_label(accelerator: &str) -> String {
    let mac = cfg!(target_os = "macos");
    let parts: Vec<String> = accelerator
        .split('+')
        .map(|p| {
            let lower = p.trim().to_ascii_lowercase();
            let named = match (mac, lower.as_str()) {
                (true, "commandorcontrol" | "cmdorctrl" | "command" | "cmd" | "super" | "meta") => {
                    "⌘"
                }
                (true, "control" | "ctrl") => "⌃",
                (true, "alt" | "option") => "⌥",
                (true, "shift") => "⇧",
                (false, "commandorcontrol" | "cmdorctrl" | "control" | "ctrl") => "Ctrl",
                (false, "super" | "meta" | "command" | "cmd") => "Win",
                (false, "alt" | "option") => "Alt",
                (false, "shift") => "Shift",
                _ => return p.trim().to_string(),
            };
            named.to_string()
        })
        .collect();
    parts.join(if mac { "" } else { "+" })
}

fn build_menu(app: &AppHandle, snap: &UiSnapshot) -> tauri::Result<Menu<Wry>> {
    let s = &snap.settings;
    let open = MenuItem::with_id(
        app,
        "open",
        format!("Open Island    {}", shortcut_label(&s.toggle_shortcut)),
        true,
        None::<&str>,
    )?;
    let dnd = CheckMenuItem::with_id(
        app,
        "dnd",
        "Do Not Disturb",
        true,
        s.do_not_disturb,
        None::<&str>,
    )?;
    let hide = CheckMenuItem::with_id(
        app,
        "hide",
        "Hide Island",
        true,
        snap.island_hidden,
        None::<&str>,
    )?;
    let test = MenuItem::with_id(app, "test", "Send Test Notification", true, None::<&str>)?;
    let api_label = match (&snap.api.url, &snap.api.error) {
        (Some(url), _) => format!("API: {url}"),
        (None, Some(_)) => "API: Port Unavailable".into(),
        (None, None) => "API: Off".into(),
    };
    let api = MenuItem::with_id(app, "api", api_label, false, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Islet", true, None::<&str>)?;
    let (s1, s2, s3) = (
        PredefinedMenuItem::separator(app)?,
        PredefinedMenuItem::separator(app)?,
        PredefinedMenuItem::separator(app)?,
    );
    Menu::with_items(
        app,
        &[
            &open, &dnd, &hide, &s1, &test, &api, &s2, &settings, &s3, &quit,
        ],
    )
}

fn on_menu_event(app: &AppHandle, id: &str) {
    let st = actions::state(app);
    match id {
        "open" => actions::toggle_island(app),
        "dnd" => actions::set_do_not_disturb(app, !st.read(|i| i.settings.do_not_disturb)),
        "hide" => actions::set_island_hidden(app, !st.read(|i| i.island_hidden)),
        "test" => {
            if let Err(e) = actions::send_test_notification(app) {
                log::warn!("test notification failed: {e}");
            }
        }
        "settings" => actions::open_settings(app),
        "quit" => actions::quit(app),
        _ => {}
    }
}

pub fn create(app: &AppHandle, snap: &UiSnapshot) -> tauri::Result<()> {
    let menu = build_menu(app, snap)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon(snap.settings.do_not_disturb))
        .icon_as_template(true)
        .tooltip(tooltip(snap))
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| on_menu_event(app, event.id().as_ref()))
        .build(app)?;
    Ok(())
}

/// Rebuilds the menu so check marks always match the core state. Menu calls
/// wait on the main thread, so never call this while holding the state lock.
pub fn refresh(app: &AppHandle, snap: &UiSnapshot) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    match build_menu(app, snap) {
        Ok(menu) => {
            let _ = tray.set_menu(Some(menu));
        }
        Err(e) => log::warn!("tray menu rebuild failed: {e}"),
    }
    let _ = tray.set_icon(Some(icon(snap.settings.do_not_disturb)));
    let _ = tray.set_icon_as_template(true);
    let _ = tray.set_tooltip(Some(tooltip(snap)));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_shortcuts_for_the_current_os() {
        let label = shortcut_label("CommandOrControl+Shift+Space");
        if cfg!(target_os = "macos") {
            assert_eq!(label, "⌘⇧Space");
        } else {
            assert_eq!(label, "Ctrl+Shift+Space");
        }
    }
}
