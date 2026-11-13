pub(crate) mod audio;
mod capture;
mod displays;
mod fullscreen;
mod island;
mod media;

use tauri::{AppHandle, Monitor, WebviewWindow};

use super::adapter::PlatformAdapter;
use crate::core::geometry::{DisplayGeometry, Point, Rect};
use crate::core::island::IslandLayout;
use crate::core::media::{MediaCommand, NowPlaying};
use crate::errors::AppResult;

/// Windows works in physical pixels of the virtual screen. Tauri marks the
/// process per-monitor DPI aware (v2), so GetCursorPos and monitor
/// rectangles both use unscaled physical coordinates.
pub struct WindowsAdapter;

impl PlatformAdapter for WindowsAdapter {
    fn monitor_geometry(&self, monitor: &Monitor) -> (Rect, f64) {
        displays::monitor_geometry(monitor)
    }

    fn pointer_position(&self) -> AppResult<Point> {
        displays::pointer_position()
    }

    fn prepare_island(&self, window: &WebviewWindow) {
        island::prepare(window);
    }

    fn place_island(&self, window: &WebviewWindow, origin: Point, display: &DisplayGeometry) {
        island::place(window, origin, display);
    }

    fn show_island(&self, window: &WebviewWindow) {
        island::show(window);
    }

    fn set_click_through(&self, window: &WebviewWindow, through: bool) {
        island::set_click_through(window, through);
    }

    fn focus_island(&self, window: &WebviewWindow) {
        island::focus(window);
    }

    fn island_layout(&self, _app: &AppHandle) -> IslandLayout {
        // No notch: the page draws a floating pill below the top edge.
        IslandLayout::initial()
    }

    fn foreground_token(&self) -> Option<i64> {
        island::foreground_window()
    }

    fn restore_foreground(&self, app: &AppHandle, token: i64) {
        island::focus_window(app, token);
    }

    fn audio_playing(&self) -> bool {
        audio::output_peak().is_some_and(|peak| peak > audio::SILENCE)
    }

    fn full_screen(&self) -> Option<bool> {
        Some(fullscreen::active())
    }

    fn camera_in_use(&self) -> bool {
        capture::in_use("webcam")
    }

    fn microphone_in_use(&self) -> bool {
        capture::in_use("microphone")
    }

    fn now_playing(&self) -> Option<NowPlaying> {
        media::now_playing()
    }

    fn media_control(&self, player: &str, command: MediaCommand) -> AppResult<()> {
        media::control(player, command)
    }
}
