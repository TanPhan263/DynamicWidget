use tauri::{AppHandle, Manager, WebviewWindow};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowLongPtrW, GetWindowThreadProcessId, IsWindow,
    SetForegroundWindow, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_SHOWNOACTIVATE, WS_EX_APPWINDOW,
    WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
};

use crate::core::geometry::{DisplayGeometry, Point};
use crate::core::island::WINDOW_WIDTH;

/// Runs `f` with the island's HWND on the main (UI) thread.
fn with_hwnd(window: &WebviewWindow, f: impl FnOnce(HWND) + Send + 'static) {
    let w = window.clone();
    let _ = window.app_handle().run_on_main_thread(move || {
        if let Ok(h) = w.hwnd() {
            f(HWND(h.0 as _));
        }
    });
}

/// Hidden from Alt+Tab and the taskbar (tool window), and topmost. The
/// island stays activatable so the Notes widget can take keyboard input.
fn apply_ex_style(hwnd: HWND) {
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let wanted = (style | WS_EX_TOOLWINDOW.0 | WS_EX_TOPMOST.0) & !WS_EX_APPWINDOW.0;
        if wanted != style {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, wanted as isize);
        }
    }
}

pub fn prepare(window: &WebviewWindow) {
    with_hwnd(window, apply_ex_style);
}

pub fn place(window: &WebviewWindow, origin: Point, d: &DisplayGeometry) {
    let (x, y) = (origin.x.round() as i32, origin.y.round() as i32);
    let w = (WINDOW_WIDTH * d.units_per_css_px).round() as i32;
    // As tall as the display, so the open panel can reach its bottom.
    let h = d.bounds.height.round() as i32;
    with_hwnd(window, move |hwnd| unsafe {
        // Moving onto a monitor with a different DPI triggers WM_DPICHANGED,
        // which resizes the window to a scaled rectangle. Applying the
        // physical rectangle a second time, now on the target monitor,
        // makes the result exact.
        for _ in 0..2 {
            let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), x, y, w, h, SWP_NOACTIVATE);
        }
    });
}

pub fn show(window: &WebviewWindow) {
    with_hwnd(window, |hwnd| unsafe {
        apply_ex_style(hwnd);
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    });
}

/// Click-through on or off, with the same styles tao uses. Done here rather
/// than through tao: the island is shown with `ShowWindow` above, so tao still
/// thinks it is hidden, and any tao flag change would hide it again.
pub fn set_click_through(window: &WebviewWindow, through: bool) {
    with_hwnd(window, move |hwnd| unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let bits = WS_EX_TRANSPARENT.0 | WS_EX_LAYERED.0;
        let wanted = if through { style | bits } else { style & !bits };
        if wanted != style {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, wanted as isize);
        }
    });
}

/// Keyboard focus for the island. tao's `set_focus` does nothing while it
/// thinks the window is hidden (see [`set_click_through`]).
pub fn focus(window: &WebviewWindow) {
    with_hwnd(window, |hwnd| unsafe {
        let _ = SetForegroundWindow(hwnd);
    });
}

pub fn foreground_window() -> Option<i64> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        (pid != std::process::id()).then_some(hwnd.0 as i64)
    }
}

pub fn focus_window(app: &AppHandle, token: i64) {
    let _ = app.run_on_main_thread(move || unsafe {
        let hwnd = HWND(token as _);
        // The handle may belong to a window that closed in the meantime.
        if IsWindow(Some(hwnd)).as_bool() {
            let _ = SetForegroundWindow(hwnd);
        }
    });
}
