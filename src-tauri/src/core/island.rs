//! Island engine thread. The island is one transparent window, larger than
//! the island ever gets, pinned to the top center of the primary display.
//! The page reports the rectangle the island currently covers; this thread
//! polls the pointer and lets clicks through everywhere else, so the menu
//! bar and apps under the empty part of the window keep working.
//!
//! A click-through window gets no mouse events, so hover is detected here
//! and sent to the page as an event instead of relying on `mouseenter`.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::OnceLock;
use std::thread::{self, Thread};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use super::geometry::{DisplayGeometry, Point, Rect};
use crate::actions;

pub const ISLAND_LABEL: &str = "island";
/// Window width in CSS pixels, matching `tauri.conf.json`; the page lays the
/// island out inside it. The height is stretched to the display's, so the open
/// panel can reach the bottom; the page reads the real height from the window.
pub const WINDOW_WIDTH: f64 = 1000.0;
/// Upper bound for rectangles the page reports; taller than any display.
pub const MAX_WINDOW_HEIGHT: f64 = 6000.0;

pub const ISLAND_HOVER: &str = "island-hover";
pub const ISLAND_LAYOUT: &str = "island-layout";

const POINTER_POLL: Duration = Duration::from_millis(30);
/// While the pointer is farther than [`NEAR`] from the island it is read this
/// often; hover waits 120 ms before opening anyway.
const FAR_POLL: Duration = Duration::from_millis(120);
/// CSS pixels around the island where the pointer is read at full speed.
const NEAR: f64 = 200.0;
const DISPLAY_POLL: Duration = Duration::from_secs(2);
/// How often full screen is checked, and how long the thread sleeps while
/// the island is hidden (`wake` cuts that short).
const IDLE_POLL: Duration = Duration::from_secs(1);

static ENGINE: OnceLock<Thread> = OnceLock::new();

/// Wakes the engine so a hide or show takes effect now, not after `IDLE_POLL`.
pub fn wake() {
    if let Some(t) = ENGINE.get() {
        t.unpark();
    }
}

/// The island steps aside for full-screen apps unless it was asked for.
fn shows(hidden: bool, full_screen: bool, summoned: bool) -> bool {
    !hidden && (!full_screen || summoned)
}
/// Extra hit area around the island, in CSS pixels, so a fast pointer at
/// the screen edge still counts as hovering.
const HIT_SLOP: f64 = 4.0;

/// The notch cut-out of a MacBook display, in CSS pixels.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notch {
    pub width: f64,
    pub height: f64,
}

/// How the page should shape the island on the current display.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandLayout {
    pub platform: &'static str,
    /// When set, the compact island hugs the notch.
    pub notch: Option<Notch>,
    /// macOS menu bar height in CSS pixels; 0 elsewhere.
    pub menu_bar_height: f64,
}

impl IslandLayout {
    pub fn initial() -> Self {
        Self {
            platform: crate::platform::platform_name(),
            notch: None,
            menu_bar_height: 0.0,
        }
    }
}

fn primary_display(app: &AppHandle) -> Option<DisplayGeometry> {
    let st = actions::state(app);
    let monitor = app.primary_monitor().ok().flatten().or_else(|| {
        app.available_monitors()
            .ok()
            .and_then(|m| m.into_iter().next())
    })?;
    let (bounds, units_per_css_px) = st.adapter.monitor_geometry(&monitor);
    Some(DisplayGeometry {
        bounds,
        units_per_css_px,
    })
}

struct Placement {
    display: DisplayGeometry,
    origin: Point,
}

struct Engine {
    app: AppHandle,
    window: WebviewWindow,
    placement: Option<Placement>,
    last_display_check: Option<Instant>,
    last_full_screen_check: Option<Instant>,
    full_screen: bool,
    hovering: bool,
    /// The pointer is within [`NEAR`] of the island.
    near: bool,
    visible: bool,
}

impl Engine {
    fn refresh_display(&mut self, now: Instant) {
        if self
            .last_display_check
            .is_some_and(|t| now.duration_since(t) < DISPLAY_POLL)
        {
            return;
        }
        self.last_display_check = Some(now);
        let Some(display) = primary_display(&self.app) else {
            return;
        };
        if self
            .placement
            .as_ref()
            .is_some_and(|p| p.display == display)
        {
            return;
        }
        let st = actions::state(&self.app);
        let origin = display.top_center_origin(WINDOW_WIDTH);
        st.adapter.place_island(&self.window, origin, &display);
        let layout = st.adapter.island_layout(&self.app);
        log::info!(
            "island placed at ({}, {}), notch: {:?}",
            origin.x,
            origin.y,
            layout.notch
        );
        st.mutate(|i| i.layout = layout.clone());
        let _ = self.app.emit(ISLAND_LAYOUT, &layout);
        self.placement = Some(Placement { display, origin });
    }

    fn refresh_full_screen(&mut self, now: Instant) {
        if self
            .last_full_screen_check
            .is_some_and(|t| now.duration_since(t) < IDLE_POLL)
        {
            return;
        }
        self.last_full_screen_check = Some(now);
        let st = actions::state(&self.app);
        // While Lintel is in front it can't tell; keep the last answer.
        let Some(full_screen) = st.adapter.full_screen() else {
            return;
        };
        if !full_screen {
            st.mutate(|i| i.island_summoned = false);
        }
        if full_screen != self.full_screen {
            log::info!("full screen: {full_screen}");
            self.full_screen = full_screen;
        }
    }

    fn sync_visibility(&mut self, show: bool) {
        let want = show && self.placement.is_some();
        if want == self.visible {
            return;
        }
        let st = actions::state(&self.app);
        if want {
            st.adapter.show_island(&self.window);
        } else {
            let _ = self.window.hide();
            self.set_hover(false);
        }
        self.visible = want;
    }

    fn set_hover(&mut self, inside: bool) {
        if inside == self.hovering {
            return;
        }
        self.hovering = inside;
        let _ = self.window.set_ignore_cursor_events(!inside);
        if inside {
            // Remember who had focus before a click can move it to the island.
            let st = actions::state(&self.app);
            if let Some(token) = st.adapter.foreground_token() {
                st.mutate(|i| i.previous_foreground = Some(token));
            }
        }
        let _ = self.app.emit_to(ISLAND_LABEL, ISLAND_HOVER, inside);
    }

    fn tick(&mut self) {
        let st = actions::state(&self.app);
        let now = Instant::now();
        self.refresh_display(now);
        self.refresh_full_screen(now);
        let (hidden, summoned, rect) =
            st.read(|i| (i.island_hidden, i.island_summoned, i.island_rect));
        self.sync_visibility(shows(hidden, self.full_screen, summoned));
        if !self.visible {
            return;
        }
        let (Some(p), Some(rect)) = (&self.placement, rect) else {
            return;
        };
        let Ok(pointer) = st.adapter.pointer_position() else {
            return;
        };
        let to_native = |r: Rect| p.display.window_rect_to_native(p.origin, r);
        self.near = to_native(rect.outset(NEAR)).contains(pointer);
        self.set_hover(to_native(rect.outset(HIT_SLOP)).contains(pointer));
    }
}

pub fn spawn(app: AppHandle) {
    let Some(window) = app.get_webview_window(ISLAND_LABEL) else {
        log::error!("island window missing from configuration");
        return;
    };
    actions::state(&app).adapter.prepare_island(&window);
    let _ = window.set_ignore_cursor_events(true);

    let spawned = thread::Builder::new()
        .name("lintel-island".into())
        .spawn(move || {
            let mut engine = Engine {
                app: app.clone(),
                window,
                placement: None,
                last_display_check: None,
                last_full_screen_check: None,
                full_screen: false,
                hovering: false,
                near: true,
                visible: false,
            };
            let _ = ENGINE.set(thread::current());
            loop {
                if actions::state(&app).read(|i| i.quitting) {
                    break;
                }
                // A panic in one tick (a platform call gone wrong) must not
                // leave the island frozen; log it and keep going.
                if catch_unwind(AssertUnwindSafe(|| engine.tick())).is_err() {
                    log::error!("island tick panicked");
                }
                // Hidden, nothing needs the pointer; wake only to check full screen.
                if engine.visible {
                    thread::sleep(if engine.near || engine.hovering {
                        POINTER_POLL
                    } else {
                        FAR_POLL
                    });
                } else {
                    thread::park_timeout(IDLE_POLL);
                }
            }
        });
    if let Err(e) = spawned {
        log::error!("island engine did not start: {e}");
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn steps_aside_for_full_screen_unless_asked_for() {
        assert!(super::shows(false, false, false));
        assert!(!super::shows(false, true, false));
        assert!(
            super::shows(false, true, true),
            "the shortcut brings it back"
        );
        assert!(
            !super::shows(true, false, true),
            "hidden from the tray wins"
        );
    }
}
