//! Whether the frontmost app fills the main display: a full-screen space, or
//! a borderless game or video. Window bounds and owners need no permission.

use core_foundation::base::{CFType, TCFType};
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::display::CGDisplay;
use core_graphics::window::{
    copy_window_info, kCGNullWindowID, kCGWindowBounds, kCGWindowLayer,
    kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly, kCGWindowOwnerPID,
};

/// An on-screen window: owner, layer and `[x, y, width, height]` in points.
struct Window {
    pid: i64,
    layer: i64,
    bounds: [f64; 4],
}

/// A normal window (layer 0) of `pid` exactly covering `display`.
fn fills(windows: &[Window], pid: i64, display: [f64; 4]) -> bool {
    windows.iter().any(|w| {
        w.pid == pid
            && w.layer == 0
            && w.bounds
                .iter()
                .zip(display)
                .all(|(a, b)| (a - b).abs() < 1.0)
    })
}

fn number(dict: &CFDictionary<CFString, CFType>, key: &CFString) -> Option<f64> {
    dict.find(key)?.downcast::<CFNumber>()?.to_f64()
}

fn on_screen_windows() -> Vec<Window> {
    let Some(list) = copy_window_info(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID,
    ) else {
        return Vec::new();
    };
    // SAFETY: these are CoreGraphics' constant keys.
    let (pid_key, layer_key, bounds_key) = unsafe {
        (
            CFString::wrap_under_get_rule(kCGWindowOwnerPID),
            CFString::wrap_under_get_rule(kCGWindowLayer),
            CFString::wrap_under_get_rule(kCGWindowBounds),
        )
    };
    let edges = ["X", "Y", "Width", "Height"].map(CFString::from_static_string);
    list.iter()
        .filter_map(|item| {
            // SAFETY: every element of the window list is a CFDictionary.
            let dict: CFDictionary<CFString, CFType> =
                unsafe { CFDictionary::wrap_under_get_rule((*item).cast()) };
            let bounds = dict.find(&bounds_key)?.downcast::<CFDictionary>()?;
            // SAFETY: the bounds dictionary maps strings to numbers.
            let bounds: CFDictionary<CFString, CFType> =
                unsafe { CFDictionary::wrap_under_get_rule(bounds.as_concrete_TypeRef()) };
            let mut rect = [0.0; 4];
            for (slot, key) in rect.iter_mut().zip(&edges) {
                *slot = number(&bounds, key)?;
            }
            Some(Window {
                pid: number(&dict, &pid_key)? as i64,
                layer: number(&dict, &layer_key)? as i64,
                bounds: rect,
            })
        })
        .collect()
}

/// True while the frontmost app fills the main display; `None` while
/// Lintel itself is in front.
pub fn active() -> Option<bool> {
    let pid = super::island::frontmost_pid()?;
    let b = CGDisplay::main().bounds();
    let display = [b.origin.x, b.origin.y, b.size.width, b.size.height];
    Some(fills(&on_screen_windows(), pid, display))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: [f64; 4] = [0.0, 0.0, 1512.0, 982.0];

    fn w(pid: i64, layer: i64, bounds: [f64; 4]) -> Window {
        Window { pid, layer, bounds }
    }

    #[test]
    fn only_a_normal_window_of_the_front_app_covering_the_screen() {
        assert!(fills(&[w(7, 0, SCREEN)], 7, SCREEN));
        assert!(!fills(&[w(8, 0, SCREEN)], 7, SCREEN), "another app");
        assert!(
            !fills(&[w(7, 25, SCREEN)], 7, SCREEN),
            "the menu bar or a panel"
        );
        assert!(
            !fills(&[w(7, 0, [0.0, 37.0, 1512.0, 945.0])], 7, SCREEN),
            "a zoomed window leaves the menu bar"
        );
    }

    /// Reads the real window list; run with `cargo test -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn reads_windows() {
        assert!(!on_screen_windows().is_empty());
        println!("full screen: {:?}", active());
    }
}
