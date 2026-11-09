//! In-memory notification history. Every source (local API, battery
//! monitor, island widgets) goes through [`NotificationCenter::push`], which
//! validates and trims the input so the UI can trust what it renders.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

use super::settings_service::normalize_color;
use crate::errors::{AppError, AppResult};

/// Older notifications are dropped once the history holds this many.
pub const HISTORY_LIMIT: usize = 50;
pub const TITLE_MAX: usize = 120;
pub const BODY_MAX: usize = 500;
pub const APP_MAX: usize = 40;
/// An icon is an emoji or a couple of letters, never markup or a URL.
pub const ICON_MAX: usize = 4;
/// A small raster picture, such as a website's icon, as a data URL.
pub const IMAGE_MAX: usize = 12 * 1024;
/// SVG is left out: it can carry scripts and links.
const IMAGE_TYPES: [&str; 4] = ["png", "jpeg", "webp", "gif"];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NotificationSource {
    /// Sent to the local HTTP API by a script or tool.
    Api,
    /// Raised by Islet itself (battery, settings test).
    System,
    /// Raised by an island widget, such as the timer.
    Widget,
    /// A website notification forwarded by the paired browser extension.
    Browser,
}

/// Built-in icons for notifications Islet raises itself. The page draws
/// them as vector icons; senders on the API use `icon` text instead.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Symbol {
    Battery,
    BatteryCharging,
    BatteryFull,
    BatteryLow,
    BatteryWarning,
    Timer,
    Sparkles,
    Recording,
}

/// What a sender provides. Missing fields fall back to sensible defaults.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct NotificationInput {
    pub title: String,
    pub body: Option<String>,
    /// Name of the sending app or script, shown above the title.
    pub app: Option<String>,
    pub icon: Option<String>,
    /// Accent color as `#rgb` or `#rrggbb`.
    pub accent: Option<String>,
    /// `data:image/png;base64,…` (or jpeg, webp, gif), up to [`IMAGE_MAX`] bytes.
    pub image: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: u64,
    pub title: String,
    pub body: String,
    pub app: String,
    pub icon: Option<String>,
    pub image: Option<String>,
    pub symbol: Option<Symbol>,
    pub accent: Option<String>,
    pub source: NotificationSource,
    /// Unix time in milliseconds.
    pub created_at: u64,
}

/// Collapses whitespace (including newlines) and cuts to `max` characters,
/// adding an ellipsis when something was cut.
pub(crate) fn clean(input: &str, max: usize) -> String {
    let collapsed = input.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max {
        return collapsed;
    }
    let mut out: String = collapsed.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Accepts only a base64 data URL of a raster image type.
pub(crate) fn check_image(image: &str) -> AppResult<String> {
    let bad =
        || AppError::Validation("image must be a base64 PNG, JPEG, WebP or GIF data URL".into());
    if image.len() > IMAGE_MAX {
        return Err(AppError::Validation(format!(
            "image is larger than {IMAGE_MAX} bytes"
        )));
    }
    let rest = image.strip_prefix("data:image/").ok_or_else(bad)?;
    let (kind, data) = rest.split_once(";base64,").ok_or_else(bad)?;
    let ok_data = !data.is_empty()
        && data
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='));
    if !IMAGE_TYPES.contains(&kind) || !ok_data {
        return Err(bad());
    }
    Ok(image.to_string())
}

fn default_app(source: NotificationSource) -> &'static str {
    match source {
        NotificationSource::Api => "Script",
        NotificationSource::Browser => "Website",
        NotificationSource::System => "Islet",
        NotificationSource::Widget => "Islet",
    }
}

#[derive(Debug, Default)]
pub struct NotificationCenter {
    items: VecDeque<Notification>,
    next_id: u64,
}

impl NotificationCenter {
    pub fn push(
        &mut self,
        input: NotificationInput,
        symbol: Option<Symbol>,
        source: NotificationSource,
        now_ms: u64,
    ) -> AppResult<Notification> {
        let title = clean(&input.title, TITLE_MAX);
        if title.is_empty() {
            return Err(AppError::Validation("A notification needs a title".into()));
        }
        let accent = match input
            .accent
            .as_deref()
            .map(str::trim)
            .filter(|a| !a.is_empty())
        {
            None => None,
            Some(a) => Some(normalize_color(a).ok_or_else(|| {
                AppError::Validation(format!("\"{a}\" is not a hex color like #22c55e"))
            })?),
        };
        let icon = input
            .icon
            .as_deref()
            .map(str::trim)
            .filter(|i| !i.is_empty())
            .map(|i| i.chars().take(ICON_MAX).collect::<String>());
        let image = match input
            .image
            .as_deref()
            .map(str::trim)
            .filter(|i| !i.is_empty())
        {
            None => None,
            Some(i) => Some(check_image(i)?),
        };
        let app = input
            .app
            .as_deref()
            .map(|a| clean(a, APP_MAX))
            .filter(|a| !a.is_empty())
            .unwrap_or_else(|| default_app(source).to_string());

        self.next_id += 1;
        let n = Notification {
            id: self.next_id,
            title,
            body: input
                .body
                .as_deref()
                .map(|b| clean(b, BODY_MAX))
                .unwrap_or_default(),
            app,
            icon,
            image,
            symbol,
            accent,
            source,
            created_at: now_ms,
        };
        self.items.push_front(n.clone());
        self.items.truncate(HISTORY_LIMIT);
        Ok(n)
    }

    pub fn dismiss(&mut self, id: u64) -> bool {
        let before = self.items.len();
        self.items.retain(|n| n.id != id);
        self.items.len() != before
    }

    pub fn clear(&mut self) {
        self.items.clear();
    }

    /// Newest first.
    pub fn list(&self) -> Vec<Notification> {
        self.items.iter().cloned().collect()
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(title: &str) -> NotificationInput {
        NotificationInput {
            title: title.into(),
            ..Default::default()
        }
    }

    #[test]
    fn push_fills_defaults_and_orders_newest_first() {
        let mut c = NotificationCenter::default();
        let a = c
            .push(input("Build passed"), None, NotificationSource::Api, 1)
            .unwrap();
        let b = c
            .push(input("Timer done"), None, NotificationSource::Widget, 2)
            .unwrap();
        assert_eq!(a.app, "Script");
        assert_eq!(b.app, "Islet");
        assert_eq!(a.body, "");
        assert!(b.id > a.id);
        assert_eq!(
            c.list().iter().map(|n| n.id).collect::<Vec<_>>(),
            vec![b.id, a.id]
        );
    }

    #[test]
    fn empty_title_is_rejected() {
        let mut c = NotificationCenter::default();
        assert!(c
            .push(input("   \n "), None, NotificationSource::Api, 0)
            .is_err());
        assert!(c.list().is_empty());
    }

    #[test]
    fn text_is_collapsed_and_truncated() {
        let mut c = NotificationCenter::default();
        let n = c
            .push(
                NotificationInput {
                    title: "Deploy\n\n  finished".into(),
                    body: Some("x".repeat(BODY_MAX + 20)),
                    app: Some("  ci  ".into()),
                    icon: Some("🚀🚀🚀🚀🚀🚀".into()),
                    accent: Some("#0F0".into()),
                    image: None,
                },
                None,
                NotificationSource::Api,
                0,
            )
            .unwrap();
        assert_eq!(n.title, "Deploy finished");
        assert_eq!(n.body.chars().count(), BODY_MAX);
        assert!(n.body.ends_with('…'));
        assert_eq!(n.app, "ci");
        assert_eq!(n.icon.as_deref().map(|i| i.chars().count()), Some(ICON_MAX));
        assert_eq!(n.accent.as_deref(), Some("#00ff00"));
    }

    #[test]
    fn bad_accent_is_rejected_but_blank_is_ignored() {
        let mut c = NotificationCenter::default();
        let bad = NotificationInput {
            accent: Some("red".into()),
            ..input("x")
        };
        assert!(c.push(bad, None, NotificationSource::Api, 0).is_err());
        let blank = NotificationInput {
            accent: Some(" ".into()),
            ..input("x")
        };
        assert_eq!(
            c.push(blank, None, NotificationSource::Api, 0)
                .unwrap()
                .accent,
            None
        );
    }

    #[test]
    fn only_raster_data_urls_are_images() {
        let mut c = NotificationCenter::default();
        let with = |image: &str| NotificationInput {
            image: Some(image.into()),
            ..input("x")
        };
        let png = "data:image/png;base64,iVBORw0KGgo=";
        let n = c
            .push(with(png), None, NotificationSource::Browser, 0)
            .unwrap();
        assert_eq!(n.image.as_deref(), Some(png));
        assert_eq!(n.app, "Website");
        for bad in [
            "https://example.com/icon.png",
            "data:image/svg+xml;base64,PHN2Zz4=",
            "data:image/png,raw",
            "data:image/png;base64,<script>",
            "javascript:alert(1)",
        ] {
            assert!(
                c.push(with(bad), None, NotificationSource::Browser, 0)
                    .is_err(),
                "{bad}"
            );
        }
        let big = format!("data:image/png;base64,{}", "A".repeat(IMAGE_MAX));
        assert!(c
            .push(with(&big), None, NotificationSource::Browser, 0)
            .is_err());
    }

    #[test]
    fn history_is_bounded() {
        let mut c = NotificationCenter::default();
        for i in 0..HISTORY_LIMIT + 5 {
            c.push(
                input(&format!("n{i}")),
                None,
                NotificationSource::Api,
                i as u64,
            )
            .unwrap();
        }
        let list = c.list();
        assert_eq!(list.len(), HISTORY_LIMIT);
        assert_eq!(list[0].title, format!("n{}", HISTORY_LIMIT + 4));
    }

    #[test]
    fn dismiss_and_clear() {
        let mut c = NotificationCenter::default();
        let a = c
            .push(input("a"), None, NotificationSource::Api, 0)
            .unwrap();
        c.push(input("b"), None, NotificationSource::Api, 0)
            .unwrap();
        assert!(c.dismiss(a.id));
        assert!(!c.dismiss(a.id));
        assert_eq!(c.list().len(), 1);
        c.clear();
        assert!(c.list().is_empty());
    }

    #[test]
    fn senders_cannot_pick_a_built_in_symbol() {
        let r = serde_json::from_str::<NotificationInput>(r#"{"title":"x","symbol":"battery"}"#);
        assert!(r.is_err());
    }

    #[test]
    fn symbols_serialize_in_kebab_case() {
        let mut c = NotificationCenter::default();
        let n = c
            .push(
                input("x"),
                Some(Symbol::BatteryCharging),
                NotificationSource::System,
                0,
            )
            .unwrap();
        assert_eq!(
            serde_json::to_value(&n).unwrap()["symbol"],
            "battery-charging"
        );
    }

    #[test]
    fn unknown_fields_are_rejected() {
        let r = serde_json::from_str::<NotificationInput>(r#"{"title":"x","html":"<b>"}"#);
        assert!(r.is_err());
    }
}
