use core_graphics::event::CGEvent;
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use tauri::Monitor;

use crate::core::geometry::{Point, Rect};
use crate::errors::{AppError, AppResult};

/// Tauri reports macOS monitor geometry as points multiplied by that
/// monitor's scale factor. Dividing by the same factor recovers the global
/// point coordinates, which stay consistent across mixed-DPI layouts.
pub fn monitor_geometry(monitor: &Monitor) -> (Rect, f64) {
    let scale = monitor.scale_factor();
    let pos = monitor.position().to_logical::<f64>(scale);
    let size = monitor.size().to_logical::<f64>(scale);
    (Rect::new(pos.x, pos.y, size.width, size.height), 1.0)
}

/// Reads the pointer location from a synthetic event. This is cheap and
/// needs no permission.
pub fn pointer_position() -> AppResult<Point> {
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| AppError::Platform("could not create event source".into()))?;
    let event =
        CGEvent::new(source).map_err(|_| AppError::Platform("could not read pointer".into()))?;
    let p = event.location();
    Ok(Point { x: p.x, y: p.y })
}
