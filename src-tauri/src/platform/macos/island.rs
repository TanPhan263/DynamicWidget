use std::sync::mpsc;
use std::time::Duration;

use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSApplicationActivationOptions, NSMainMenuWindowLevel, NSRunningApplication, NSScreen,
    NSWindow, NSWindowAnimationBehavior, NSWindowCollectionBehavior, NSWorkspace,
};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow};

use crate::core::geometry::Point;
use crate::core::island::{IslandLayout, Notch, WINDOW_WIDTH};

/// Menu bar height on displays where AppKit reports none (auto-hidden menu
/// bar). Matches the standard macOS menu bar.
const DEFAULT_MENU_BAR_HEIGHT: f64 = 24.0;

/// Runs `f` with the island's NSWindow on the main thread. AppKit must not
/// be touched from the engine thread.
fn with_ns_window(window: &WebviewWindow, f: impl FnOnce(&NSWindow) + Send + 'static) {
    let w = window.clone();
    let _ = window.app_handle().run_on_main_thread(move || {
        if let Ok(ptr) = w.ns_window() {
            // SAFETY: Tauri returns a valid NSWindow pointer for a live
            // window, and we are on the main thread.
            let ns = unsafe { &*(ptr as *const NSWindow) };
            f(ns);
        }
    });
}

pub fn prepare(window: &WebviewWindow) {
    with_ns_window(window, |ns| {
        // One level above the menu bar, so the island can sit over the
        // notch area and the middle of the menu bar like the real thing.
        ns.setLevel(NSMainMenuWindowLevel + 1);
        ns.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        ns.setHasShadow(false);
        ns.setHidesOnDeactivate(false);
        ns.setAnimationBehavior(NSWindowAnimationBehavior::None);
    });
}

pub fn place(window: &WebviewWindow, origin: Point, height: f64) {
    let _ = window.set_size(LogicalSize::new(WINDOW_WIDTH, height));
    let _ = window.set_position(LogicalPosition::new(origin.x, origin.y));
}

pub fn show(window: &WebviewWindow) {
    // orderFrontRegardless shows the window without making it key or
    // activating Lintel, so keyboard focus stays where it was.
    with_ns_window(window, |ns| ns.orderFrontRegardless());
}

/// Reads the notch from the primary screen (the one with the menu bar).
/// `safeAreaInsets` and the auxiliary areas exist on macOS 12+, which is
/// the minimum supported version.
fn read_layout(mtm: MainThreadMarker) -> IslandLayout {
    let mut layout = IslandLayout::initial();
    let screens = NSScreen::screens(mtm);
    let Some(screen) = screens.firstObject() else {
        return layout;
    };
    let frame = screen.frame();
    let visible = screen.visibleFrame();
    let menu_bar = (frame.origin.y + frame.size.height) - (visible.origin.y + visible.size.height);
    layout.menu_bar_height = if menu_bar > 0.0 {
        menu_bar
    } else {
        DEFAULT_MENU_BAR_HEIGHT
    };

    let top_inset = screen.safeAreaInsets().top;
    if top_inset > 0.0 {
        let left = screen.auxiliaryTopLeftArea().size.width;
        let right = screen.auxiliaryTopRightArea().size.width;
        let width = frame.size.width - left - right;
        if width > 0.0 && width < frame.size.width {
            layout.notch = Some(Notch {
                width,
                height: top_inset,
            });
            layout.menu_bar_height = top_inset;
        }
    }
    layout
}

pub fn layout(app: &AppHandle) -> IslandLayout {
    let (tx, rx) = mpsc::channel();
    let posted = app.run_on_main_thread(move || {
        if let Some(mtm) = MainThreadMarker::new() {
            let _ = tx.send(read_layout(mtm));
        }
    });
    if posted.is_err() {
        return IslandLayout::initial();
    }
    rx.recv_timeout(Duration::from_secs(2))
        .unwrap_or_else(|_| IslandLayout::initial())
}

pub fn frontmost_pid() -> Option<i64> {
    let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    let pid = app.processIdentifier();
    (pid > 0 && pid as u32 != std::process::id()).then_some(pid as i64)
}

pub fn activate_pid(app: &AppHandle, pid: i64) {
    let _ = app.run_on_main_thread(move || {
        if let Some(target) =
            NSRunningApplication::runningApplicationWithProcessIdentifier(pid as i32)
        {
            target.activateWithOptions(NSApplicationActivationOptions::empty());
        }
    });
}
