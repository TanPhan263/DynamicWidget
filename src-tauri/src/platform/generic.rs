//! Best-effort adapter for unsupported desktops so the crate still builds.
//! Without pointer tracking the island never receives clicks there.

use tauri::{AppHandle, Monitor, WebviewWindow};

use super::adapter::PlatformAdapter;
use crate::core::geometry::{DisplayGeometry, Point, Rect};
use crate::core::island::IslandLayout;
use crate::core::media::NowPlaying;
use crate::errors::{AppError, AppResult};

pub struct GenericAdapter;

impl PlatformAdapter for GenericAdapter {
    fn monitor_geometry(&self, m: &Monitor) -> (Rect, f64) {
        let (p, s) = (m.position(), m.size());
        (
            Rect::new(p.x as f64, p.y as f64, s.width as f64, s.height as f64),
            m.scale_factor(),
        )
    }

    fn pointer_position(&self) -> AppResult<Point> {
        Err(AppError::Platform(
            "pointer tracking is not supported on this OS".into(),
        ))
    }

    fn prepare_island(&self, _window: &WebviewWindow) {}

    fn place_island(&self, window: &WebviewWindow, origin: Point, _display: &DisplayGeometry) {
        let _ = window.set_position(tauri::PhysicalPosition::new(
            origin.x as i32,
            origin.y as i32,
        ));
    }

    fn show_island(&self, window: &WebviewWindow) {
        let _ = window.show();
    }

    fn island_layout(&self, _app: &AppHandle) -> IslandLayout {
        IslandLayout::initial()
    }

    fn foreground_token(&self) -> Option<i64> {
        None
    }

    fn restore_foreground(&self, _app: &AppHandle, _token: i64) {}

    fn audio_playing(&self) -> bool {
        false
    }

    fn now_playing(&self) -> Option<NowPlaying> {
        None
    }
}
