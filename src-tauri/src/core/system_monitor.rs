//! Samples CPU, memory and battery every couple of seconds for the island's
//! System widget and charging live activity, and turns battery transitions
//! into notifications.

use crate::i18n::{text, Text};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use starship_battery::units::{ratio::percent, time::minute};
use sysinfo::System;
use tauri::{AppHandle, Emitter};

use super::media::{NowPlaying, WEB_FRESH};
use super::notifications::{NotificationInput, NotificationSource, Symbol};
use crate::actions;

pub const SYSTEM_STATS: &str = "system-stats";
const INTERVAL: Duration = Duration::from_secs(2);
/// Low battery alerts fire once each time the level drops past one of these.
const LOW_THRESHOLDS: [f32; 2] = [20.0, 10.0];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PowerState {
    Charging,
    Discharging,
    Full,
    /// On power but holding the charge (macOS optimized charging, charge limits).
    NotCharging,
    Unknown,
}

impl PowerState {
    pub fn on_power(self) -> bool {
        matches!(
            self,
            PowerState::Charging | PowerState::Full | PowerState::NotCharging
        )
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatteryInfo {
    pub percent: f32,
    pub state: PowerState,
    /// Minutes to empty while discharging, or to full while charging.
    pub minutes_remaining: Option<u32>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub cpu_percent: f32,
    pub memory_used: u64,
    pub memory_total: u64,
    /// `None` on desktops without a battery.
    pub battery: Option<BatteryInfo>,
    /// Some app is playing sound, such as music or a video.
    pub audio_playing: bool,
    /// Some app has a camera open.
    pub camera_in_use: bool,
    /// Some app is recording from a microphone.
    pub microphone_in_use: bool,
    /// What is playing, when a website or player says.
    pub now_playing: Option<NowPlaying>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BatteryEvent {
    PluggedIn,
    Unplugged,
    Low(f32),
    Full,
}

/// Transitions between two consecutive samples worth telling the user about.
pub fn battery_events(prev: &BatteryInfo, cur: &BatteryInfo) -> Vec<BatteryEvent> {
    let mut events = Vec::new();
    let (was, is) = (prev.state, cur.state);
    if was != PowerState::Unknown && is != PowerState::Unknown {
        if !was.on_power() && is.on_power() {
            events.push(BatteryEvent::PluggedIn);
        } else if was.on_power() && !is.on_power() {
            events.push(BatteryEvent::Unplugged);
        }
    }
    if was == PowerState::Charging && is == PowerState::Full {
        events.push(BatteryEvent::Full);
    }
    if !is.on_power() {
        // Only the lowest threshold crossed in one step is reported.
        if let Some(t) = LOW_THRESHOLDS
            .iter()
            .filter(|&&t| prev.percent > t && cur.percent <= t)
            .copied()
            .reduce(f32::min)
        {
            events.push(BatteryEvent::Low(t));
        }
    }
    events
}

fn event_notification(e: BatteryEvent, b: &BatteryInfo, lang: &str) -> (NotificationInput, Symbol) {
    let pct = (b.percent.round() as u32).to_string();
    let tr = |t: Text| text(lang, t).replace("{pct}", &pct);
    let (title, body, symbol, accent) = match e {
        BatteryEvent::PluggedIn => (
            tr(Text::Charging),
            tr(Text::PowerConnected),
            Symbol::BatteryCharging,
            "#22c55e",
        ),
        BatteryEvent::Unplugged => (
            tr(Text::OnBattery),
            tr(Text::Remaining),
            Symbol::Battery,
            "#737373",
        ),
        BatteryEvent::Full => (
            tr(Text::FullyCharged),
            tr(Text::Unplug),
            Symbol::BatteryFull,
            "#22c55e",
        ),
        BatteryEvent::Low(t) => (
            text(lang, Text::BatteryAt).replace("{pct}", &(t as u32).to_string()),
            tr(Text::ChargeSoon),
            if t <= 10.0 {
                Symbol::BatteryWarning
            } else {
                Symbol::BatteryLow
            },
            if t <= 10.0 { "#ef4444" } else { "#f59e0b" },
        ),
    };
    let input = NotificationInput {
        title,
        body: Some(body),
        app: Some("Battery".into()),
        icon: None,
        accent: Some(accent.into()),
        image: None,
    };
    (input, symbol)
}

fn map_state(s: starship_battery::State) -> PowerState {
    use starship_battery::State;
    match s {
        State::Charging => PowerState::Charging,
        State::Discharging | State::Empty => PowerState::Discharging,
        State::Full => PowerState::Full,
        State::Paused => PowerState::NotCharging,
        _ => PowerState::Unknown,
    }
}

fn read_battery(manager: Option<&starship_battery::Manager>) -> Option<BatteryInfo> {
    // Desktop Macs report a phantom battery with no capacity and a NaN
    // charge; only a battery with a real capacity counts.
    let b = manager?
        .batteries()
        .ok()?
        .flatten()
        .find(|b| b.state_of_charge().value.is_finite() && b.energy_full().value > 0.0)?;
    let state = map_state(b.state());
    let remaining = match state {
        PowerState::Charging => b.time_to_full(),
        PowerState::Discharging => b.time_to_empty(),
        _ => None,
    };
    Some(BatteryInfo {
        percent: b.state_of_charge().get::<percent>().clamp(0.0, 100.0),
        state,
        minutes_remaining: remaining
            .map(|t| t.get::<minute>().round() as u32)
            .filter(|m| *m > 0),
    })
}

pub fn spawn(app: AppHandle) {
    let spawned = thread::Builder::new()
        .name("lintel-system".into())
        .spawn(move || {
            let mut sys = System::new().ok();
            let manager = starship_battery::Manager::new()
                .map_err(|e| log::info!("battery info unavailable: {e}"))
                .ok();
            let mut prev_battery: Option<BatteryInfo> = None;
            let mut prev_playing: Option<NowPlaying> = None;
            loop {
                let st = actions::state(&app);
                if st.read(|i| i.quitting) {
                    break;
                }
                let mut stats = SystemStats::default();
                if let Some(sys) = sys.as_mut() {
                    sys.refresh_cpu_usage();
                    sys.refresh_memory();
                    stats.cpu_percent = sys.global_cpu_usage();
                    stats.memory_used = sys.used_memory();
                    stats.memory_total = sys.total_memory();
                }
                stats.battery = read_battery(manager.as_ref());
                stats.audio_playing = st.adapter.audio_playing();
                stats.camera_in_use = st.adapter.camera_in_use();
                stats.microphone_in_use = st.adapter.microphone_in_use();
                // A website's own report wins; desktop players are only asked
                // while sound plays, since asking starts a process.
                let web = st.read(|i| {
                    i.web_media
                        .as_ref()
                        .filter(|(_, at)| at.elapsed() < WEB_FRESH)
                        .map(|(np, _)| np.clone())
                });
                let from_web = matches!(web, Some(Some(_)));
                stats.now_playing = match web {
                    Some(np @ Some(_)) => np,
                    _ if stats.audio_playing => st.adapter.now_playing(),
                    _ => None,
                };
                if stats.now_playing != prev_playing {
                    match &stats.now_playing {
                        Some(np) => log::info!(
                            "now playing ({}): app={:?} title={:?} artist={:?} image={}",
                            if from_web {
                                "browser"
                            } else {
                                "desktop player"
                            },
                            np.app,
                            np.title,
                            np.artist,
                            np.image.is_some()
                        ),
                        None => log::info!(
                            "now playing: nothing (sound playing: {})",
                            stats.audio_playing
                        ),
                    }
                    prev_playing = stats.now_playing.clone();
                }

                if let (Some(prev), Some(cur)) = (&prev_battery, &stats.battery) {
                    if st.read(|i| i.settings.battery_alerts) {
                        for e in battery_events(prev, cur) {
                            let lang = st.read(|i| i.ui_language);
                            let (input, symbol) = event_notification(e, cur, lang);
                            if let Err(e) = actions::push_notification(
                                &app,
                                input,
                                Some(symbol),
                                NotificationSource::System,
                            ) {
                                log::warn!("battery notification rejected: {e}");
                            }
                        }
                    }
                }
                prev_battery = stats.battery.clone();

                st.mutate(|i| i.stats = stats.clone());
                let _ = app.emit(SYSTEM_STATS, &stats);
                thread::sleep(INTERVAL);
            }
        });
    if let Err(e) = spawned {
        log::error!("system monitor did not start: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b(pct: f32, state: PowerState) -> BatteryInfo {
        BatteryInfo {
            percent: pct,
            state,
            minutes_remaining: None,
        }
    }

    #[test]
    fn plug_and_unplug() {
        use PowerState::*;
        assert_eq!(
            battery_events(&b(50.0, Discharging), &b(50.0, Charging)),
            vec![BatteryEvent::PluggedIn]
        );
        assert_eq!(
            battery_events(&b(50.0, NotCharging), &b(50.0, Discharging)),
            vec![BatteryEvent::Unplugged]
        );
        assert!(battery_events(&b(50.0, Charging), &b(51.0, Charging)).is_empty());
        assert!(
            battery_events(&b(50.0, Unknown), &b(50.0, Charging)).is_empty(),
            "first reliable sample is silent"
        );
    }

    #[test]
    fn full_only_after_charging() {
        use PowerState::*;
        assert_eq!(
            battery_events(&b(99.0, Charging), &b(100.0, Full)),
            vec![BatteryEvent::Full]
        );
        assert!(battery_events(&b(100.0, NotCharging), &b(100.0, Full)).is_empty());
    }

    #[test]
    fn low_battery_fires_once_per_threshold() {
        use PowerState::*;
        assert_eq!(
            battery_events(&b(21.0, Discharging), &b(20.0, Discharging)),
            vec![BatteryEvent::Low(20.0)]
        );
        assert!(battery_events(&b(20.0, Discharging), &b(19.0, Discharging)).is_empty());
        // A big drop past both thresholds reports only the lower one.
        assert_eq!(
            battery_events(&b(25.0, Discharging), &b(9.0, Discharging)),
            vec![BatteryEvent::Low(10.0)]
        );
        // Never while charging.
        assert!(battery_events(&b(21.0, Charging), &b(20.0, Charging)).is_empty());
    }

    #[test]
    fn notifications_are_valid_input() {
        let mut center = crate::core::notifications::NotificationCenter::default();
        for e in [
            BatteryEvent::PluggedIn,
            BatteryEvent::Unplugged,
            BatteryEvent::Full,
            BatteryEvent::Low(10.0),
        ] {
            let (input, symbol) = event_notification(e, &b(10.0, PowerState::Discharging), "en");
            assert!(center
                .push(input, Some(symbol), NotificationSource::System, 0)
                .is_ok());
        }
    }
}
