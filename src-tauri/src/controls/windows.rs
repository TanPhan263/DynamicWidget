//! Windows side of the Controls widget. Wi-Fi, Bluetooth and airplane mode
//! go through the Radios API Quick Settings uses; volume through Core
//! Audio; brightness through the display driver; dark mode through the
//! theme settings. Night light has no public switch, so it is left out.

use std::os::windows::process::CommandExt;
use std::process::Command;

use windows::core::{w, HSTRING, PCWSTR};
use windows::Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState};
use windows::Win32::Foundation::{
    CloseHandle, ERROR_SUCCESS, GENERIC_READ, GENERIC_WRITE, HANDLE, LPARAM, WPARAM,
};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::Registry::{
    RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_DWORD, RRF_RT_REG_DWORD,
};
use windows::Win32::System::IO::DeviceIoControl;
use windows::Win32::UI::WindowsAndMessaging::{
    SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
};

use super::{Change, Controls};
use crate::errors::{AppError, AppResult};
use crate::platform::windows::audio::endpoint_volume;

/// Console programs started from Lintel would flash a window without this.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn read() -> Controls {
    let radios = radios();
    let wifi = radio_state(&radios, RadioKind::WiFi);
    let (volume, muted) = volume();
    Controls {
        wifi,
        wifi_name: if wifi == Some(true) {
            wifi_name()
        } else {
            None
        },
        bluetooth: radio_state(&radios, RadioKind::Bluetooth),
        airplane: (!radios.is_empty()).then(|| radios.iter().all(|r| !is_on(r))),
        volume,
        muted,
        brightness: brightness(),
        dark_mode: dark_mode(),
        night_light: None,
        energy_saver: energy_saver(),
    }
}

pub fn set(change: Change) -> AppResult<()> {
    match change {
        Change::Wifi(on) => set_radios(Some(RadioKind::WiFi), on),
        Change::Bluetooth(on) => set_radios(Some(RadioKind::Bluetooth), on),
        // shortcut: turns every radio off or on rather than the system's own
        // airplane switch, which has no public API; Quick Settings' Airplane
        // tile may not light up.
        Change::Airplane(on) => set_radios(None, !on),
        Change::Volume(level) => set_volume(level),
        Change::Brightness(level) => set_brightness(level),
        Change::DarkMode(on) => set_dark_mode(on),
        // Windows has no public switch for energy saver, so this opens its page.
        Change::EnergySaver(_) => {
            Command::new("explorer")
                .arg("ms-settings:batterysaver")
                .spawn()?;
            Ok(())
        }
        Change::NightLight(_) => Err(AppError::Platform(
            "Windows has no public switch for Night light".into(),
        )),
    }
}

// ---- Radios: Wi-Fi, Bluetooth, airplane mode ----

fn radios() -> Vec<Radio> {
    let _ = Radio::RequestAccessAsync().and_then(|op| op.join());
    Radio::GetRadiosAsync()
        .and_then(|op| op.join())
        .map(|list| list.into_iter().collect())
        .unwrap_or_default()
}

fn is_on(radio: &Radio) -> bool {
    radio.State().is_ok_and(|s| s == RadioState::On)
}

fn radio_state(radios: &[Radio], kind: RadioKind) -> Option<bool> {
    let mut of_kind = radios
        .iter()
        .filter(|r| r.Kind().is_ok_and(|k| k == kind))
        .peekable();
    of_kind.peek()?;
    Some(of_kind.any(is_on))
}

/// Switches the radios of `kind`, or all of them.
fn set_radios(kind: Option<RadioKind>, on: bool) -> AppResult<()> {
    let state = if on { RadioState::On } else { RadioState::Off };
    let radios: Vec<Radio> = radios()
        .into_iter()
        .filter(|r| kind.is_none_or(|k| r.Kind().is_ok_and(|rk| rk == k)))
        .collect();
    if radios.is_empty() {
        return Err(AppError::Platform("this PC has no such radio".into()));
    }
    for radio in radios {
        let status = radio
            .SetStateAsync(state)
            .and_then(|op| op.join())
            .map_err(|e| AppError::Platform(e.to_string()))?;
        if status != RadioAccessStatus::Allowed {
            return Err(AppError::Platform(
                "Windows didn't let Lintel switch this; check Settings → Privacy & security → Radios"
                    .into(),
            ));
        }
    }
    Ok(())
}

fn wifi_name() -> Option<String> {
    let out = Command::new("netsh")
        .args(["wlan", "show", "interfaces"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    parse_ssid(&String::from_utf8_lossy(&out.stdout))
}

/// The "SSID : name" line of `netsh wlan show interfaces` (not "BSSID").
fn parse_ssid(text: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        (key.trim() == "SSID")
            .then(|| value.trim().to_owned())
            .filter(|v| !v.is_empty())
    })
}

// ---- Volume ----

fn volume() -> (Option<f32>, Option<bool>) {
    let Some(endpoint) = endpoint_volume() else {
        return (None, None);
    };
    // SAFETY: COM calls on the endpoint's own interface.
    unsafe {
        (
            endpoint.GetMasterVolumeLevelScalar().ok(),
            endpoint.GetMute().ok().map(|m| m.as_bool()),
        )
    }
}

fn set_volume(level: f32) -> AppResult<()> {
    let endpoint = endpoint_volume().ok_or_else(|| AppError::Platform("no sound output".into()))?;
    let fail =
        |e: windows::core::Error| AppError::Platform(format!("could not set the volume: {e}"));
    // SAFETY: COM calls on the endpoint's own interface.
    unsafe {
        endpoint
            .SetMasterVolumeLevelScalar(level, std::ptr::null())
            .map_err(fail)?;
        // Raising the volume unmutes, like the volume keys.
        if level > 0.0 {
            endpoint.SetMute(false, std::ptr::null()).map_err(fail)?;
        }
    }
    Ok(())
}

// ---- Brightness of the built-in screen, through the display driver ----

const IOCTL_VIDEO_QUERY_DISPLAY_BRIGHTNESS: u32 = 0x0023_0498;
const IOCTL_VIDEO_SET_DISPLAY_BRIGHTNESS: u32 = 0x0023_049C;
/// Applies to both mains and battery.
const DISPLAYPOLICY_BOTH: u8 = 3;

#[repr(C)]
#[derive(Default)]
struct DisplayBrightness {
    policy: u8,
    ac: u8,
    dc: u8,
}

/// The built-in screen's driver; desktops without one have no such device.
struct Lcd(HANDLE);

impl Lcd {
    fn open() -> Option<Lcd> {
        // SAFETY: opens a device by name; `Lcd` closes it.
        unsafe {
            CreateFileW(
                w!(r"\\.\LCD"),
                (GENERIC_READ | GENERIC_WRITE).0,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                None,
                OPEN_EXISTING,
                FILE_FLAGS_AND_ATTRIBUTES(0),
                None,
            )
        }
        .ok()
        .map(Lcd)
    }

    fn query(&self) -> Option<DisplayBrightness> {
        let mut out = DisplayBrightness::default();
        let mut returned = 0u32;
        // SAFETY: `out` is the driver's 3-byte struct and its size is given.
        unsafe {
            DeviceIoControl(
                self.0,
                IOCTL_VIDEO_QUERY_DISPLAY_BRIGHTNESS,
                None,
                0,
                Some((&mut out as *mut DisplayBrightness).cast()),
                size_of::<DisplayBrightness>() as u32,
                Some(&mut returned),
                None,
            )
        }
        .ok()
        .map(|_| out)
    }

    fn set(&self, percent: u8) -> bool {
        let value = DisplayBrightness {
            policy: DISPLAYPOLICY_BOTH,
            ac: percent,
            dc: percent,
        };
        // SAFETY: `value` is the driver's 3-byte struct and its size is given.
        unsafe {
            DeviceIoControl(
                self.0,
                IOCTL_VIDEO_SET_DISPLAY_BRIGHTNESS,
                Some((&value as *const DisplayBrightness).cast()),
                size_of::<DisplayBrightness>() as u32,
                None,
                0,
                None,
                None,
            )
        }
        .is_ok()
    }
}

impl Drop for Lcd {
    fn drop(&mut self) {
        // SAFETY: opened by `Lcd::open`, closed once.
        let _ = unsafe { CloseHandle(self.0) };
    }
}

fn on_mains() -> bool {
    power_status().is_none_or(|s| s.ACLineStatus == 1)
}

fn brightness() -> Option<f32> {
    let b = Lcd::open()?.query()?;
    Some(f32::from(if on_mains() { b.ac } else { b.dc }) / 100.0)
}

fn set_brightness(level: f32) -> AppResult<()> {
    let percent = (level * 100.0).round() as u8;
    let lcd = Lcd::open()
        .ok_or_else(|| AppError::Platform("this screen's brightness can't be set here".into()))?;
    if lcd.set(percent) && brightness().is_some_and(|b| (b * 100.0).round() as u8 == percent) {
        return Ok(());
    }
    // Some drivers ignore the old call; WMI is what Settings' slider uses.
    let script = format!(
        "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,{percent})"
    );
    let ok = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .status()?
        .success();
    ok.then_some(())
        .ok_or_else(|| AppError::Platform("the brightness did not change".into()))
}

// ---- Dark mode ----

const PERSONALIZE: &str = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

fn read_dword(name: &str) -> Option<u32> {
    let mut value = 0u32;
    let mut size = size_of::<u32>() as u32;
    // SAFETY: `value` is a DWORD and `size` says so.
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            &HSTRING::from(PERSONALIZE),
            &HSTRING::from(name),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut value as *mut u32).cast()),
            Some(&mut size),
        )
    };
    (status == ERROR_SUCCESS).then_some(value)
}

fn dark_mode() -> Option<bool> {
    // Missing means the default, light.
    Some(read_dword("AppsUseLightTheme").unwrap_or(1) == 0)
}

fn set_dark_mode(on: bool) -> AppResult<()> {
    let light = u32::from(!on);
    for name in ["AppsUseLightTheme", "SystemUsesLightTheme"] {
        // SAFETY: writes one DWORD from `light`.
        let status = unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                &HSTRING::from(PERSONALIZE),
                &HSTRING::from(name),
                REG_DWORD.0,
                Some((&light as *const u32).cast()),
                size_of::<u32>() as u32,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(AppError::Platform("could not switch dark mode".into()));
        }
    }
    // Tells open apps and the taskbar to repaint in the new theme.
    let topic = w!("ImmersiveColorSet");
    // SAFETY: a broadcast with a static string; hung windows are skipped.
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            WPARAM(0),
            LPARAM(PCWSTR(topic.as_ptr()).0 as isize),
            SMTO_ABORTIFHUNG,
            200,
            None,
        )
    };
    Ok(())
}

// ---- Energy saver ----

fn power_status() -> Option<SYSTEM_POWER_STATUS> {
    let mut status = SYSTEM_POWER_STATUS::default();
    // SAFETY: fills `status`.
    unsafe { GetSystemPowerStatus(&mut status) }.ok()?;
    Some(status)
}

fn energy_saver() -> Option<bool> {
    let status = power_status()?;
    // 128: this PC has no battery, so no energy saver either.
    (status.BatteryFlag != 128).then_some(status.SystemStatusFlag == 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_network_name() {
        let text = "    Name                   : Wi-Fi\n    State                  : connected\n    SSID                   : Home 5G\n    BSSID                  : aa:bb:cc:dd:ee:ff\n";
        assert_eq!(parse_ssid(text).as_deref(), Some("Home 5G"));
        assert_eq!(parse_ssid("    State : disconnected\n"), None);
    }
}
