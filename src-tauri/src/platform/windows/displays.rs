use tauri::Monitor;
use windows::Win32::Foundation::POINT;
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

use crate::core::geometry::{Point, Rect};
use crate::errors::{AppError, AppResult};

/// Monitor rectangles are physical pixels in virtual-screen coordinates
/// (secondary monitors may be negative). The island webview uses
/// CSS pixels of `scale_factor` physical pixels each.
pub fn monitor_geometry(monitor: &Monitor) -> (Rect, f64) {
    let pos = monitor.position();
    let size = monitor.size();
    (
        Rect::new(
            pos.x as f64,
            pos.y as f64,
            size.width as f64,
            size.height as f64,
        ),
        monitor.scale_factor(),
    )
}

pub fn pointer_position() -> AppResult<Point> {
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p) }
        .map_err(|e| AppError::Platform(format!("GetCursorPos failed: {e}")))?;
    Ok(Point {
        x: p.x as f64,
        y: p.y as f64,
    })
}
