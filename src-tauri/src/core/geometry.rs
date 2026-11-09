use serde::{Deserialize, Serialize};

/// A point in global "native" desktop units: points on macOS, physical pixels
/// on Windows. Pointer positions and display bounds share this space, so they
/// can be compared directly.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn right(&self) -> f64 {
        self.x + self.width
    }

    pub fn bottom(&self) -> f64 {
        self.y + self.height
    }

    pub fn is_empty(&self) -> bool {
        self.width <= 0.0 || self.height <= 0.0
    }

    pub fn contains(&self, p: Point) -> bool {
        !self.is_empty()
            && p.x >= self.x
            && p.x < self.right()
            && p.y >= self.y
            && p.y < self.bottom()
    }

    pub fn outset(&self, amount: f64) -> Rect {
        Rect::new(
            self.x - amount,
            self.y - amount,
            self.width + amount * 2.0,
            self.height + amount * 2.0,
        )
    }
}

/// The display the island lives on.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DisplayGeometry {
    /// Bounds in global native units (see [`Point`]).
    pub bounds: Rect,
    /// Native units per CSS pixel inside the island webview: 1.0 on macOS
    /// (points), the monitor scale factor on Windows (physical pixels).
    pub units_per_css_px: f64,
}

impl DisplayGeometry {
    /// Top-left corner, in native units, of a window `css_width` CSS pixels
    /// wide centered horizontally at the top edge of this display.
    pub fn top_center_origin(&self, css_width: f64) -> Point {
        let width = css_width * self.units_per_css_px;
        Point {
            x: (self.bounds.x + (self.bounds.width - width) / 2.0).round(),
            y: self.bounds.y,
        }
    }

    /// Converts a rectangle in the island window's CSS pixels into global
    /// native units, given the window's native origin.
    pub fn window_rect_to_native(&self, origin: Point, r: Rect) -> Rect {
        let u = self.units_per_css_px.max(0.01);
        Rect::new(
            origin.x + r.x * u,
            origin.y + r.y * u,
            r.width * u,
            r.height * u,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contains_is_half_open() {
        let r = Rect::new(0.0, 0.0, 10.0, 10.0);
        assert!(r.contains(Point { x: 0.0, y: 0.0 }));
        assert!(r.contains(Point { x: 9.9, y: 9.9 }));
        assert!(!r.contains(Point { x: 10.0, y: 5.0 }));
        assert!(!Rect::new(0.0, 0.0, 0.0, 10.0).contains(Point { x: 0.0, y: 0.0 }));
    }

    #[test]
    fn outset_grows_all_sides() {
        let r = Rect::new(10.0, 10.0, 10.0, 10.0).outset(5.0);
        assert_eq!(r, Rect::new(5.0, 5.0, 20.0, 20.0));
    }

    #[test]
    fn top_center_on_scaled_secondary_display() {
        // Windows: a 150% display at physical (2560, -200), 3840 px wide.
        let d = DisplayGeometry {
            bounds: Rect::new(2560.0, -200.0, 3840.0, 2160.0),
            units_per_css_px: 1.5,
        };
        // 720 CSS px = 1080 physical px, centered: 2560 + (3840 - 1080) / 2.
        assert_eq!(
            d.top_center_origin(720.0),
            Point {
                x: 3940.0,
                y: -200.0
            }
        );
    }

    #[test]
    fn window_rect_maps_to_native_units() {
        let d = DisplayGeometry {
            bounds: Rect::new(0.0, 0.0, 3840.0, 2160.0),
            units_per_css_px: 2.0,
        };
        let r = d.window_rect_to_native(
            Point { x: 100.0, y: 0.0 },
            Rect::new(10.0, 0.0, 200.0, 32.0),
        );
        assert_eq!(r, Rect::new(120.0, 0.0, 400.0, 64.0));
    }
}
