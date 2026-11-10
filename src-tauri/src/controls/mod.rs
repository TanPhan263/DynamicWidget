//! The Controls widget, a control center in the island: Wi-Fi, Bluetooth,
//! airplane mode, volume, brightness, dark mode, night light and energy
//! saver. Each reads `None` where this system can't do it, and the widget
//! leaves that control out.

use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as os;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use self::windows as os;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod os {
    use super::{Change, Controls};
    use crate::errors::{AppError, AppResult};

    pub fn read() -> Controls {
        Controls::default()
    }

    pub fn set(_: Change) -> AppResult<()> {
        Err(AppError::Platform("not available on this OS".into()))
    }
}

/// What the controls show right now.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Controls {
    pub wifi: Option<bool>,
    /// The network Wi-Fi is joined to, when the system says.
    pub wifi_name: Option<String>,
    pub bluetooth: Option<bool>,
    pub airplane: Option<bool>,
    /// Output volume, 0 to 1.
    pub volume: Option<f32>,
    pub muted: Option<bool>,
    /// Built-in display brightness, 0 to 1.
    pub brightness: Option<f32>,
    pub dark_mode: Option<bool>,
    /// Night light on Windows, Night Shift on macOS.
    pub night_light: Option<bool>,
    /// Energy saver on Windows, Low Power Mode on macOS.
    pub energy_saver: Option<bool>,
}

/// One change the widget asks for, as `{ control, value }`.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(tag = "control", content = "value", rename_all = "kebab-case")]
pub enum Change {
    Wifi(bool),
    Bluetooth(bool),
    Airplane(bool),
    Volume(f32),
    Brightness(f32),
    DarkMode(bool),
    NightLight(bool),
    EnergySaver(bool),
}

/// Dimmer than this looks like a dead screen, so the slider stops here.
const MIN_BRIGHTNESS: f32 = 0.05;

pub fn read() -> Controls {
    os::read()
}

/// Applies a change and returns the controls as they are afterwards.
pub fn set(change: Change) -> AppResult<Controls> {
    os::set(checked(change)?)?;
    Ok(read())
}

/// Levels from the page must be numbers; they're kept within range.
fn checked(change: Change) -> AppResult<Change> {
    let level = |v: f32, min: f32| {
        v.is_finite()
            .then(|| v.clamp(min, 1.0))
            .ok_or_else(|| AppError::Validation("a level must be a number from 0 to 1".into()))
    };
    Ok(match change {
        Change::Volume(v) => Change::Volume(level(v, 0.0)?),
        Change::Brightness(v) => Change::Brightness(level(v, MIN_BRIGHTNESS)?),
        other => other,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changes_parse_from_the_page() {
        let c: Change = serde_json::from_str(r#"{"control":"wifi","value":false}"#).unwrap();
        assert_eq!(c, Change::Wifi(false));
        let c: Change = serde_json::from_str(r#"{"control":"dark-mode","value":true}"#).unwrap();
        assert_eq!(c, Change::DarkMode(true));
        let c: Change = serde_json::from_str(r#"{"control":"volume","value":0.5}"#).unwrap();
        assert_eq!(c, Change::Volume(0.5));
        assert!(serde_json::from_str::<Change>(r#"{"control":"reboot","value":true}"#).is_err());
        assert!(serde_json::from_str::<Change>(r#"{"control":"wifi","value":1}"#).is_err());
    }

    #[test]
    fn levels_stay_in_range() {
        assert_eq!(checked(Change::Volume(1.7)).unwrap(), Change::Volume(1.0));
        assert_eq!(checked(Change::Volume(-1.0)).unwrap(), Change::Volume(0.0));
        assert_eq!(
            checked(Change::Brightness(0.0)).unwrap(),
            Change::Brightness(MIN_BRIGHTNESS)
        );
        assert!(checked(Change::Volume(f32::NAN)).is_err());
    }

    #[test]
    fn unknown_controls_read_as_missing() {
        let json = serde_json::to_value(Controls::default()).unwrap();
        assert_eq!(json["wifi"], serde_json::Value::Null);
        assert_eq!(json["energySaver"], serde_json::Value::Null);
        assert_eq!(json["wifiName"], serde_json::Value::Null);
    }
}
