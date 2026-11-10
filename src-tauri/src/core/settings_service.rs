//! Versioned local settings document: model, validation, migration and
//! atomic persistence. No remote store is involved.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::market;
use crate::errors::{AppError, AppResult};

pub const CURRENT_SCHEMA_VERSION: u32 = 1;
pub const NOTIFICATION_SECONDS_RANGE: (u32, u32) = (2, 30);
/// The API only binds unprivileged ports.
pub const API_PORT_RANGE: (u16, u16) = (1024, 65535);

const SETTINGS_FILE: &str = "settings.json";

/// What makes the island open into the full panel.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExpandTrigger {
    Hover,
    Click,
}

/// How the island is drawn.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IslandStyle {
    /// Hangs from the top edge of the screen, around the notch if there is
    /// one. Files from before "auto" was removed load as this.
    #[serde(alias = "auto")]
    Notch,
    /// A floating capsule just below the top edge, like the iPhone
    /// Dynamic Island.
    Island,
}

/// The background of the open panel and the floating island. The page
/// holds the colors; the core only stores the choice.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IslandTheme {
    Black,
    Midnight,
    Aurora,
    Ember,
    Slate,
    /// Nearly clear: the desktop shows through.
    Glass,
    /// The user's own picture, saved by `background`.
    Picture,
    /// Black into graphite, tinted by the playing cover. Last so unknown
    /// names (from newer versions) can load as this.
    #[default]
    #[serde(other)]
    Graphite,
}

/// Smallest and largest island size, in percent of the default size.
pub const ISLAND_SIZE_RANGE: (u8, u8) = (50, 150);
/// The open panel gets cramped below this.
pub const PANEL_SIZE_RANGE: (u8, u8) = (80, 150);

/// Scale of part of the island, in percent of its default size.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "SizeRepr", into = "u8")]
pub struct IslandSize(pub u8);

impl IslandSize {
    pub fn new(percent: u8) -> Self {
        Self(percent.clamp(ISLAND_SIZE_RANGE.0, ISLAND_SIZE_RANGE.1))
    }
}

impl Default for IslandSize {
    fn default() -> Self {
        Self(100)
    }
}

impl From<IslandSize> for u8 {
    fn from(s: IslandSize) -> u8 {
        s.0
    }
}

/// Accepts a percent, and the earlier `"small"` / `"medium"` / `"large"`
/// names, so files written before the slider still load.
#[derive(Deserialize)]
#[serde(untagged)]
enum SizeRepr {
    Percent(f64),
    Named(String),
}

impl From<SizeRepr> for IslandSize {
    fn from(r: SizeRepr) -> Self {
        match r {
            SizeRepr::Percent(p) => IslandSize::new(p.round().clamp(0.0, 255.0) as u8),
            SizeRepr::Named(name) => IslandSize::new(match name.as_str() {
                "small" => 88,
                "large" => 112,
                _ => 100,
            }),
        }
    }
}

/// Where the music bars go while sound plays.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BarsPosition {
    /// In the closed island, beside the notch.
    Inside,
    /// Under the island, with the title.
    Below,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MusicBars {
    pub enabled: bool,
    pub position: BarsPosition,
    /// Bars hang down instead of standing up.
    pub flipped: bool,
    /// Gradient from the bars' base to their tips; the same twice is solid.
    pub colors: [String; 2],
    /// Show the title of what is playing.
    pub show_title: bool,
}

impl Default for MusicBars {
    fn default() -> Self {
        Self {
            enabled: true,
            position: BarsPosition::Inside,
            flipped: false,
            colors: ["#ffffff".into(), "#ffffff".into()],
            show_title: true,
        }
    }
}

/// Widest and tallest a widget can be, in grid cells.
pub const WIDGET_MAX_COLS: u8 = 3;
pub const WIDGET_MAX_ROWS: u8 = 2;

/// How many grid cells a widget covers in the open island.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "SpanRepr")]
pub struct WidgetSpan {
    pub cols: u8,
    pub rows: u8,
}

impl WidgetSpan {
    pub fn new(cols: u8, rows: u8) -> Self {
        Self {
            cols: cols.clamp(1, WIDGET_MAX_COLS),
            rows: rows.clamp(1, WIDGET_MAX_ROWS),
        }
    }
}

/// Accepts `{ "cols": 2, "rows": 1 }`, and the earlier `"small"` / `"wide"`
/// names, so files written before free resizing still load.
#[derive(Deserialize)]
#[serde(untagged)]
enum SpanRepr {
    Named(String),
    Span { cols: u8, rows: u8 },
}

impl From<SpanRepr> for WidgetSpan {
    fn from(r: SpanRepr) -> Self {
        match r {
            SpanRepr::Named(name) if name == "wide" => WidgetSpan::new(2, 1),
            SpanRepr::Named(_) => WidgetSpan::new(1, 1),
            SpanRepr::Span { cols, rows } => WidgetSpan::new(cols, rows),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WidgetId {
    Clock,
    Calendar,
    Timer,
    System,
    Notes,
    /// Buttons for quick system actions; see `quick_actions`.
    Actions,
    /// Prices of the symbols in [`SettingsV1::stocks`].
    Stocks,
    /// The track playing, with play, pause and skip.
    Media,
    /// Today's weather and the next days, from `weather`.
    Weather,
}

impl WidgetId {
    pub const ALL: [WidgetId; 9] = [
        WidgetId::Clock,
        WidgetId::Calendar,
        WidgetId::Timer,
        WidgetId::System,
        WidgetId::Notes,
        WidgetId::Actions,
        WidgetId::Stocks,
        WidgetId::Media,
        WidgetId::Weather,
    ];
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsV1 {
    pub schema_version: u32,
    pub expand_trigger: ExpandTrigger,
    pub island_style: IslandStyle,
    /// Background of the open panel and the floating island.
    pub theme: IslandTheme,
    /// The closed island and notifications.
    pub island_size: IslandSize,
    /// The open panel with notifications and widgets.
    pub panel_size: IslandSize,
    /// Opens or closes the island panel from anywhere.
    pub toggle_shortcut: String,
    /// How long a new notification stays open before the island shrinks back.
    pub notification_seconds: u32,
    /// Keeps notifications in the list without popping the island open.
    pub do_not_disturb: bool,
    pub widgets: Vec<WidgetId>,
    /// Widgets missing here cover one cell.
    pub widget_sizes: BTreeMap<WidgetId, WidgetSpan>,
    /// Ticker symbols the Stocks widget follows, in display order.
    pub stocks: Vec<String>,
    /// Symbols from `stocks` shown in the closed island, which takes turns
    /// showing them; at most [`market::MAX_ISLAND_STOCKS`].
    pub island_stocks: Vec<String>,
    pub music_bars: MusicBars,
    pub use_24_hour_clock: bool,
    /// Notify on charger plugged/unplugged and low battery.
    pub battery_alerts: bool,
    /// Local HTTP API that scripts and tools use to send notifications.
    pub api_enabled: bool,
    pub api_port: u16,
    pub start_at_login: bool,
    pub onboarding_completed: bool,
}

pub type Settings = SettingsV1;

impl Default for SettingsV1 {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            expand_trigger: ExpandTrigger::Hover,
            island_style: IslandStyle::Notch,
            theme: IslandTheme::Graphite,
            island_size: IslandSize::default(),
            panel_size: IslandSize::default(),
            toggle_shortcut: "CommandOrControl+Shift+Space".into(),
            notification_seconds: 5,
            do_not_disturb: false,
            widgets: WidgetId::ALL.to_vec(),
            widget_sizes: BTreeMap::new(),
            stocks: vec!["AAPL".into(), "NVDA".into(), "BTC-USD".into()],
            island_stocks: Vec::new(),
            music_bars: MusicBars::default(),
            use_24_hour_clock: false,
            battery_alerts: true,
            api_enabled: true,
            api_port: 47821,
            start_at_login: false,
            onboarding_completed: false,
        }
    }
}

/// Accepts `#rgb` or `#rrggbb` and returns lowercase `#rrggbb`.
pub fn normalize_color(input: &str) -> Option<String> {
    let hex = input.trim().strip_prefix('#')?;
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    match hex.len() {
        6 => Some(format!("#{}", hex.to_ascii_lowercase())),
        3 => Some(format!(
            "#{}",
            hex.chars()
                .flat_map(|c| [c, c])
                .collect::<String>()
                .to_ascii_lowercase()
        )),
        _ => None,
    }
}

fn clamp_numbers(s: &mut Settings) {
    s.notification_seconds = s
        .notification_seconds
        .clamp(NOTIFICATION_SECONDS_RANGE.0, NOTIFICATION_SECONDS_RANGE.1);
    s.api_port = s.api_port.clamp(API_PORT_RANGE.0, API_PORT_RANGE.1);
    s.panel_size = IslandSize(s.panel_size.0.clamp(PANEL_SIZE_RANGE.0, PANEL_SIZE_RANGE.1));
    let white = MusicBars::default().colors;
    for (color, fallback) in s.music_bars.colors.iter_mut().zip(white) {
        *color = normalize_color(color).unwrap_or(fallback);
    }
}

/// Keeps valid, distinct symbols (at most [`market::MAX_SYMBOLS`]), and
/// takes symbols that are no longer followed off the island.
fn clean_stocks(s: &mut Settings) {
    let mut seen = Vec::new();
    for symbol in s.stocks.iter().filter_map(|x| market::normalize_symbol(x)) {
        if !seen.contains(&symbol) && seen.len() < market::MAX_SYMBOLS {
            seen.push(symbol);
        }
    }
    s.stocks = seen;
    let mut shown = Vec::new();
    for symbol in s
        .island_stocks
        .iter()
        .filter_map(|x| market::normalize_symbol(x))
    {
        if s.stocks.contains(&symbol)
            && !shown.contains(&symbol)
            && shown.len() < market::MAX_ISLAND_STOCKS
        {
            shown.push(symbol);
        }
    }
    s.island_stocks = shown;
}

/// Removes duplicate widgets while keeping the first occurrence's position.
fn dedup_widgets(widgets: &mut Vec<WidgetId>) {
    let mut seen = Vec::with_capacity(widgets.len());
    widgets.retain(|w| {
        if seen.contains(w) {
            false
        } else {
            seen.push(*w);
            true
        }
    });
}

/// Strict validation for settings submitted by the UI. Numeric values are
/// clamped; structurally wrong values are rejected with a readable message.
/// Shortcut parsing is checked separately by the shortcut service.
pub fn validate(mut s: Settings) -> AppResult<Settings> {
    if s.schema_version != CURRENT_SCHEMA_VERSION {
        return Err(AppError::Validation(format!(
            "Unsupported settings version {}",
            s.schema_version
        )));
    }
    s.toggle_shortcut = s.toggle_shortcut.trim().to_string();
    if s.toggle_shortcut.is_empty() {
        return Err(AppError::Validation("The shortcut cannot be empty".into()));
    }
    dedup_widgets(&mut s.widgets);
    clamp_numbers(&mut s);
    clean_stocks(&mut s);
    Ok(s)
}

/// Lenient repair for settings read from disk: never fails, replaces bad
/// values with defaults so the app can always start.
pub fn sanitize(mut s: Settings) -> Settings {
    let d = Settings::default();
    s.schema_version = CURRENT_SCHEMA_VERSION;
    if s.toggle_shortcut.trim().is_empty() {
        s.toggle_shortcut = d.toggle_shortcut;
    }
    dedup_widgets(&mut s.widgets);
    clamp_numbers(&mut s);
    clean_stocks(&mut s);
    s
}

/// Pure migration of a raw settings document to the current schema.
/// Version 1 is the first version, so there is nothing to transform yet;
/// future versions add a match arm per step (`1 => migrate_v1_to_v2(doc)`).
pub fn migrate(doc: Value) -> AppResult<Value> {
    let version = doc
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .unwrap_or(0) as u32;
    match version {
        CURRENT_SCHEMA_VERSION => Ok(list_island_stock(split_panel_size(doc))),
        0 => {
            // Documents without a version are treated as v1 drafts.
            let mut doc = doc;
            if let Some(obj) = doc.as_object_mut() {
                obj.insert("schemaVersion".into(), Value::from(CURRENT_SCHEMA_VERSION));
            }
            Ok(list_island_stock(split_panel_size(doc)))
        }
        v => Err(AppError::Settings(format!(
            "settings version {v} is newer than this app supports"
        ))),
    }
}

/// The panel used to share the island's size. Files from before it had its
/// own keep the panel at the size it had.
fn split_panel_size(mut doc: Value) -> Value {
    if let Some(obj) = doc.as_object_mut() {
        if !obj.contains_key("panelSize") {
            if let Some(size) = obj.get("islandSize").cloned() {
                obj.insert("panelSize".into(), size);
            }
        }
    }
    doc
}

/// The island used to show one stock (`islandStock`); now it shows a list.
fn list_island_stock(mut doc: Value) -> Value {
    if let Some(obj) = doc.as_object_mut() {
        if let Some(old) = obj.remove("islandStock") {
            if !obj.contains_key("islandStocks") {
                let list = old.as_str().map(|s| vec![s]).unwrap_or_default();
                obj.insert("islandStocks".into(), serde_json::json!(list));
            }
        }
    }
    doc
}

#[derive(Debug)]
pub struct LoadOutcome {
    pub settings: Settings,
    /// Human-readable notes about recovered problems, shown in Settings.
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct SettingsStore {
    dir: PathBuf,
}

impl SettingsStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn path(&self) -> PathBuf {
        self.dir.join(SETTINGS_FILE)
    }

    pub fn load(&self) -> LoadOutcome {
        let path = self.path();
        let mut warnings = Vec::new();
        let raw = match fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return LoadOutcome {
                    settings: Settings::default(),
                    warnings,
                };
            }
            Err(e) => {
                warnings.push(format!("Could not read settings ({e}); using defaults"));
                return LoadOutcome {
                    settings: Settings::default(),
                    warnings,
                };
            }
        };

        let parsed = serde_json::from_str::<Value>(&raw)
            .map_err(|e| AppError::Settings(e.to_string()))
            .and_then(|doc| {
                let version = doc.get("schemaVersion").and_then(Value::as_u64);
                let migrated = migrate(doc)?;
                if version != Some(CURRENT_SCHEMA_VERSION as u64) {
                    self.backup(&path, &format!("v{}", version.unwrap_or(0)));
                    warnings.push("Settings were migrated; a backup was kept".into());
                }
                serde_json::from_value::<Settings>(migrated)
                    .map_err(|e| AppError::Settings(e.to_string()))
            });

        match parsed {
            Ok(s) => {
                let repaired = sanitize(s.clone());
                if repaired != s {
                    warnings.push("Some settings were out of range and were corrected".into());
                }
                LoadOutcome {
                    settings: repaired,
                    warnings,
                }
            }
            Err(e) => {
                let kept = self.backup(&path, "invalid");
                log::warn!("settings file unreadable, defaults loaded: {e}");
                warnings.push(match kept {
                    Some(p) => format!(
                        "Settings file was invalid and was kept as {}; defaults loaded",
                        p.file_name().unwrap_or_default().to_string_lossy()
                    ),
                    None => "Settings file was invalid; defaults loaded".into(),
                });
                LoadOutcome {
                    settings: Settings::default(),
                    warnings,
                }
            }
        }
    }

    /// Writes the document atomically: temp file, fsync, rename.
    pub fn save(&self, settings: &Settings) -> AppResult<()> {
        fs::create_dir_all(&self.dir)?;
        let json =
            serde_json::to_vec_pretty(settings).map_err(|e| AppError::Settings(e.to_string()))?;
        let tmp = self.dir.join(format!("{SETTINGS_FILE}.tmp"));
        {
            let mut f = fs::File::create(&tmp)?;
            f.write_all(&json)?;
            f.sync_all()?;
        }
        fs::rename(&tmp, self.path())?;
        Ok(())
    }

    fn backup(&self, path: &Path, tag: &str) -> Option<PathBuf> {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let target = self.dir.join(format!("settings.{tag}-{ts}.json"));
        fs::copy(path, &target).ok().map(|_| target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(name: &str) -> SettingsStore {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("islet-test-{name}-{ts}"));
        fs::create_dir_all(&dir).unwrap();
        SettingsStore::new(dir)
    }

    #[test]
    fn defaults_serialize_in_camel_case() {
        let json = serde_json::to_value(Settings::default()).unwrap();
        assert_eq!(json["schemaVersion"], 1);
        assert_eq!(json["expandTrigger"], "hover");
        assert_eq!(json["islandStyle"], "notch");
        assert_eq!(json["theme"], "graphite");
        assert_eq!(json["islandSize"], 100);
        assert_eq!(json["panelSize"], 100);
        assert_eq!(json["widgetSizes"], serde_json::json!({}));
        assert_eq!(json["toggleShortcut"], "CommandOrControl+Shift+Space");
        assert_eq!(json["notificationSeconds"], 5);
        assert_eq!(
            json["widgets"],
            serde_json::json!([
                "clock", "calendar", "timer", "system", "notes", "actions", "stocks", "media",
                "weather"
            ])
        );
        assert_eq!(json["apiPort"], 47821);
        assert_eq!(json["apiEnabled"], true);
        assert_eq!(json["startAtLogin"], false);
    }

    #[test]
    fn validate_clamps_numbers() {
        let s = validate(Settings {
            notification_seconds: 0,
            api_port: 80,
            ..Settings::default()
        })
        .unwrap();
        assert_eq!(s.notification_seconds, 2);
        assert_eq!(s.api_port, 1024);
        let s = validate(Settings {
            notification_seconds: 99,
            ..Settings::default()
        })
        .unwrap();
        assert_eq!(s.notification_seconds, 30);
        let s = validate(Settings {
            island_size: IslandSize::new(50),
            panel_size: IslandSize::new(50),
            ..Settings::default()
        })
        .unwrap();
        assert_eq!(s.island_size, IslandSize(50));
        assert_eq!(s.panel_size, IslandSize(80));
    }

    #[test]
    fn validate_rejects_bad_values() {
        assert!(validate(Settings {
            schema_version: 2,
            ..Settings::default()
        })
        .is_err());
        assert!(validate(Settings {
            toggle_shortcut: "  ".into(),
            ..Settings::default()
        })
        .is_err());
    }

    #[test]
    fn duplicate_widgets_keep_first_position() {
        let s = validate(Settings {
            widgets: vec![WidgetId::Timer, WidgetId::Clock, WidgetId::Timer],
            ..Settings::default()
        })
        .unwrap();
        assert_eq!(s.widgets, vec![WidgetId::Timer, WidgetId::Clock]);
    }

    #[test]
    fn widget_spans_load_old_names_and_clamp() {
        let doc = r#"{"schemaVersion":1,"widgetSizes":{"clock":"wide","timer":"small","notes":{"cols":9,"rows":0}}}"#;
        let s: Settings = serde_json::from_str(doc).unwrap();
        assert_eq!(s.widget_sizes[&WidgetId::Clock], WidgetSpan::new(2, 1));
        assert_eq!(s.widget_sizes[&WidgetId::Timer], WidgetSpan::new(1, 1));
        assert_eq!(
            s.widget_sizes[&WidgetId::Notes],
            WidgetSpan { cols: 3, rows: 1 }
        );
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(
            json["widgetSizes"]["clock"],
            serde_json::json!({"cols": 2, "rows": 1})
        );
    }

    #[test]
    fn island_size_loads_old_names_and_clamps() {
        let size = |v: &str| {
            let doc = format!(r#"{{"schemaVersion":1,"islandSize":{v}}}"#);
            serde_json::from_str::<Settings>(&doc).unwrap().island_size
        };
        assert_eq!(size(r#""small""#), IslandSize(88));
        assert_eq!(size(r#""medium""#), IslandSize(100));
        assert_eq!(size(r#""large""#), IslandSize(112));
        assert_eq!(size("104.4"), IslandSize(104));
        assert_eq!(size("300"), IslandSize(150));
        assert_eq!(size("10"), IslandSize(50));
    }

    #[test]
    fn panel_size_starts_from_the_shared_size() {
        let doc = migrate(serde_json::json!({"schemaVersion": 1, "islandSize": "large"})).unwrap();
        let s: Settings = serde_json::from_value(doc).unwrap();
        assert_eq!(s.island_size, IslandSize(112));
        assert_eq!(s.panel_size, IslandSize(112));
        let doc =
            migrate(serde_json::json!({"schemaVersion": 1, "islandSize": 60, "panelSize": 140}))
                .unwrap();
        let s: Settings = serde_json::from_value(doc).unwrap();
        assert_eq!(s.island_size, IslandSize(60));
        assert_eq!(s.panel_size, IslandSize(140));
    }

    #[test]
    fn stocks_are_cleaned_and_the_pin_follows_them() {
        let s = validate(Settings {
            stocks: vec![
                " aapl".into(),
                "AAPL".into(),
                "bad symbol".into(),
                "btc-usd".into(),
            ],
            island_stocks: vec!["btc-usd".into(), "AAPL".into(), "BTC-USD".into()],
            ..Settings::default()
        })
        .unwrap();
        assert_eq!(s.stocks, vec!["AAPL", "BTC-USD"]);
        assert_eq!(s.island_stocks, vec!["BTC-USD", "AAPL"]);
        let s = validate(Settings {
            stocks: vec!["AAPL".into(), "A".into(), "B".into(), "C".into()],
            island_stocks: vec![
                "NVDA".into(),
                "A".into(),
                "B".into(),
                "C".into(),
                "AAPL".into(),
            ],
            ..Settings::default()
        })
        .unwrap();
        // Unfollowed symbols drop off, and the island shows at most three.
        assert_eq!(s.island_stocks, vec!["A", "B", "C"]);
        let many: Vec<String> = (0..20).map(|i| format!("S{i}")).collect();
        let s = validate(Settings {
            stocks: many,
            ..Settings::default()
        })
        .unwrap();
        assert_eq!(s.stocks.len(), market::MAX_SYMBOLS);
    }

    #[test]
    fn a_single_island_stock_becomes_a_list() {
        let doc = migrate(
            serde_json::json!({"schemaVersion": 1, "stocks": ["GC=F"], "islandStock": "GC=F"}),
        )
        .unwrap();
        let s = sanitize(serde_json::from_value::<Settings>(doc).unwrap());
        assert_eq!(s.island_stocks, vec!["GC=F"]);
        let doc = migrate(serde_json::json!({"schemaVersion": 1, "islandStock": null})).unwrap();
        let s: Settings = serde_json::from_value(doc).unwrap();
        assert!(s.island_stocks.is_empty());
    }

    #[test]
    fn bar_colors_are_checked() {
        let s = validate(Settings {
            music_bars: MusicBars {
                colors: ["#F0A".into(), "red".into()],
                ..MusicBars::default()
            },
            ..Settings::default()
        })
        .unwrap();
        assert_eq!(s.music_bars.colors, ["#ff00aa", "#ffffff"]);
    }

    #[test]
    fn colors_normalize() {
        assert_eq!(normalize_color("#ABC").as_deref(), Some("#aabbcc"));
        assert_eq!(normalize_color(" #1A2b3C ").as_deref(), Some("#1a2b3c"));
        assert_eq!(normalize_color("#12345"), None);
        assert_eq!(normalize_color("000000"), None);
        assert_eq!(normalize_color("#gg0000"), None);
    }

    #[test]
    fn sanitize_repairs_instead_of_failing() {
        let s = sanitize(Settings {
            toggle_shortcut: "".into(),
            notification_seconds: 1000,
            ..Settings::default()
        });
        assert_eq!(s.toggle_shortcut, Settings::default().toggle_shortcut);
        assert_eq!(s.notification_seconds, 30);
    }

    #[test]
    fn save_and_load_round_trip() {
        let store = temp_store("roundtrip");
        let s = Settings {
            api_port: 50000,
            widgets: vec![WidgetId::Notes],
            island_style: IslandStyle::Island,
            island_size: IslandSize::new(118),
            panel_size: IslandSize::new(84),
            widget_sizes: BTreeMap::from([(WidgetId::Notes, WidgetSpan::new(2, 2))]),
            ..Settings::default()
        };
        store.save(&validate(s).unwrap()).unwrap();
        let out = store.load();
        assert!(out.warnings.is_empty());
        assert_eq!(out.settings.api_port, 50000);
        assert_eq!(out.settings.widgets, vec![WidgetId::Notes]);
        assert_eq!(out.settings.island_style, IslandStyle::Island);
        assert_eq!(out.settings.island_size, IslandSize(118));
        assert_eq!(out.settings.panel_size, IslandSize(84));
        assert_eq!(
            out.settings.widget_sizes.get(&WidgetId::Notes),
            Some(&WidgetSpan::new(2, 2))
        );
        let raw = fs::read_to_string(store.path()).unwrap();
        assert!(
            raw.contains(r#""notes": {"#),
            "sizes are keyed by widget id: {raw}"
        );
        assert!(!store.dir.join("settings.json.tmp").exists());
    }

    #[test]
    fn missing_file_loads_defaults() {
        let store = temp_store("missing");
        let out = store.load();
        assert_eq!(out.settings, Settings::default());
        assert!(out.warnings.is_empty());
    }

    #[test]
    fn invalid_file_is_preserved_and_defaults_load() {
        let store = temp_store("invalid");
        fs::write(store.path(), "{ not json").unwrap();
        let out = store.load();
        assert_eq!(out.settings, Settings::default());
        assert_eq!(out.warnings.len(), 1);
        let kept = fs::read_dir(&store.dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("settings.invalid-")
            });
        assert!(kept);
    }

    #[test]
    fn newer_schema_is_not_overwritten_silently() {
        let store = temp_store("newer");
        fs::write(store.path(), r#"{"schemaVersion": 9}"#).unwrap();
        let out = store.load();
        assert_eq!(out.settings, Settings::default());
        assert!(!out.warnings.is_empty());
    }

    #[test]
    fn unversioned_document_is_migrated_with_backup() {
        let store = temp_store("unversioned");
        fs::write(store.path(), r#"{"notificationSeconds": 8}"#).unwrap();
        let out = store.load();
        assert_eq!(out.settings.notification_seconds, 8);
        assert!(out.warnings.iter().any(|w| w.contains("migrated")));
        let backed_up = fs::read_dir(&store.dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().starts_with("settings.v0-"));
        assert!(backed_up);
    }

    #[test]
    fn partial_document_fills_defaults_and_clamps() {
        let store = temp_store("partial");
        fs::write(
            store.path(),
            r#"{"schemaVersion":1,"notificationSeconds":300,"expandTrigger":"click"}"#,
        )
        .unwrap();
        let out = store.load();
        assert_eq!(
            out.settings.island_style,
            IslandStyle::Notch,
            "files from before the style setting keep the old look"
        );
        assert_eq!(out.settings.notification_seconds, 30);
        assert_eq!(out.settings.expand_trigger, ExpandTrigger::Click);
        assert_eq!(out.settings.api_port, 47821);
    }

    #[test]
    fn unknown_themes_load_as_graphite() {
        let s: Settings = serde_json::from_str(r#"{"theme":"neon"}"#).unwrap();
        assert_eq!(s.theme, IslandTheme::Graphite);
        let s: Settings = serde_json::from_str(r#"{"theme":"aurora"}"#).unwrap();
        assert_eq!(s.theme, IslandTheme::Aurora);
    }
}
