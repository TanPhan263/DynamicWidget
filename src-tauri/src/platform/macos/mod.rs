pub(crate) mod audio;
mod camera;
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

/// macOS works in global points with the origin at the top-left corner of
/// the primary display. The pointer location and logical Tauri monitor
/// geometry share that space.
pub struct MacAdapter;

impl PlatformAdapter for MacAdapter {
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
        // As tall as the display (points are CSS px on macOS), so the open panel can reach the bottom.
        island::place(window, origin, display.bounds.height);
    }

    fn show_island(&self, window: &WebviewWindow) {
        island::show(window);
    }

    fn island_layout(&self, app: &AppHandle) -> IslandLayout {
        island::layout(app)
    }

    fn foreground_token(&self) -> Option<i64> {
        island::frontmost_pid()
    }

    fn restore_foreground(&self, app: &AppHandle, token: i64) {
        island::activate_pid(app, token);
    }

    fn audio_playing(&self) -> bool {
        audio::output_running()
    }

    fn full_screen(&self) -> Option<bool> {
        fullscreen::active()
    }

    fn camera_in_use(&self) -> bool {
        camera::in_use()
    }

    fn microphone_in_use(&self) -> bool {
        audio::input_running()
    }

    fn now_playing(&self) -> Option<NowPlaying> {
        media::now_playing()
    }

    fn media_control(&self, player: &str, command: MediaCommand) -> AppResult<()> {
        media::control(player, command)
    }
}
