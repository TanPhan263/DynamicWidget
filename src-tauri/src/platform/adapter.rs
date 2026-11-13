use tauri::{AppHandle, Monitor, WebviewWindow};

use crate::core::geometry::{DisplayGeometry, Point, Rect};
use crate::core::island::IslandLayout;
use crate::core::media::{MediaCommand, NowPlaying};
use crate::errors::AppResult;

/// Converts core intent into OS operations. Everything above this trait is
/// platform-neutral; everything below it may call AppKit or Win32.
///
/// Window methods may be called from any thread. Implementations dispatch
/// native calls to the main thread themselves.
pub trait PlatformAdapter: Send + Sync {
    /// Bounds of a monitor in global native units plus native units per CSS px.
    fn monitor_geometry(&self, monitor: &Monitor) -> (Rect, f64);
    /// Current pointer location in global native units.
    fn pointer_position(&self) -> AppResult<Point>;
    /// One-time native setup: window level, spaces, task switcher.
    fn prepare_island(&self, window: &WebviewWindow);
    /// Moves the island window so its top-left corner is at `origin`.
    fn place_island(&self, window: &WebviewWindow, origin: Point, display: &DisplayGeometry);
    /// Shows the island without taking focus from the active application.
    fn show_island(&self, window: &WebviewWindow);
    /// Notch and menu bar of the primary display.
    fn island_layout(&self, app: &AppHandle) -> IslandLayout;
    /// Identifies the focused application, unless it is Lintel itself.
    fn foreground_token(&self) -> Option<i64>;
    /// Gives focus back to what [`Self::foreground_token`] identified.
    fn restore_foreground(&self, app: &AppHandle, token: i64);
    /// Some app is playing sound (music, a video, a call).
    fn audio_playing(&self) -> bool;
    /// A full-screen app, game, video or presentation is in front; `None`
    /// when Lintel itself is in front, so it can't tell.
    fn full_screen(&self) -> Option<bool>;
    /// Some app has a camera open.
    fn camera_in_use(&self) -> bool;
    /// Some app is recording from a microphone.
    fn microphone_in_use(&self) -> bool;
    /// Unread mail in the mail app; `None` when there is no way to tell.
    fn mail_unread(&self) -> Option<u32> {
        None
    }
    /// The track a desktop player is playing, if it can be asked.
    fn now_playing(&self) -> Option<NowPlaying>;
    /// Plays, pauses or skips on `player` (a [`NowPlaying::app`]).
    fn media_control(&self, player: &str, command: MediaCommand) -> AppResult<()>;
}
