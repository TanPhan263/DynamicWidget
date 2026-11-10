//! macOS side of the Controls widget. Wi-Fi, dark mode and the settings
//! page go through system tools; Bluetooth, brightness and Night Shift
//! through the private frameworks Control Center itself uses (the same calls
//! as `blueutil`, `brightness` and `nightlight`), loaded at run time so a
//! missing one only hides its control.

use std::ffi::{c_char, c_void, CStr};
use std::process::Command;
use std::sync::OnceLock;

use core_graphics::display::CGDisplay;

use super::{Change, Controls};
use crate::errors::{AppError, AppResult};
use crate::platform::macos::audio;

pub fn read() -> Controls {
    let wifi = wifi();
    Controls {
        wifi,
        wifi_name: if wifi == Some(true) {
            wifi_name()
        } else {
            None
        },
        bluetooth: bluetooth(),
        // macOS has no airplane mode.
        airplane: None,
        volume: audio::volume(),
        muted: audio::muted(),
        brightness: brightness(),
        dark_mode: dark_mode(),
        night_light: night_shift(),
        energy_saver: low_power(),
    }
}

pub fn set(change: Change) -> AppResult<()> {
    match change {
        Change::Wifi(on) => set_wifi(on),
        Change::Bluetooth(on) => set_bluetooth(on),
        Change::Volume(level) => audio::set_volume(level)
            .then_some(())
            .ok_or_else(|| AppError::Platform("this sound output has no volume".into())),
        Change::Brightness(level) => set_brightness(level),
        Change::DarkMode(on) => set_dark_mode(on),
        Change::NightLight(on) => set_night_shift(on),
        // Only an administrator can switch Low Power Mode, so this opens its page.
        Change::EnergySaver(_) => {
            open("x-apple.systempreferences:com.apple.Battery-Settings.extension")
        }
        Change::Airplane(_) => Err(AppError::Platform("macOS has no airplane mode".into())),
    }
}

fn output(program: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(program).args(args).output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_owned())
}

fn open(url: &str) -> AppResult<()> {
    Command::new("open").arg(url).spawn()?;
    Ok(())
}

// ---- Wi-Fi, through networksetup ----

/// The Wi-Fi interface, such as "en0"; it doesn't change while running.
fn wifi_device() -> Option<&'static str> {
    static DEVICE: OnceLock<Option<String>> = OnceLock::new();
    DEVICE
        .get_or_init(|| parse_wifi_device(&output("networksetup", &["-listallhardwareports"])?))
        .as_deref()
}

fn parse_wifi_device(ports: &str) -> Option<String> {
    let mut lines = ports.lines().map(str::trim);
    while let Some(line) = lines.next() {
        if line == "Hardware Port: Wi-Fi" || line == "Hardware Port: AirPort" {
            return lines.next()?.strip_prefix("Device: ").map(str::to_owned);
        }
    }
    None
}

fn wifi() -> Option<bool> {
    let power = output("networksetup", &["-getairportpower", wifi_device()?])?;
    Some(power.ends_with("On"))
}

/// shortcut: macOS 14.4 and later hide the network name from apps without
/// Location access, so it's often missing; ask for Location if people want it.
fn wifi_name() -> Option<String> {
    output("networksetup", &["-getairportnetwork", wifi_device()?])?
        .strip_prefix("Current Wi-Fi Network: ")
        .map(str::to_owned)
}

fn set_wifi(on: bool) -> AppResult<()> {
    let device = wifi_device().ok_or_else(|| AppError::Platform("this Mac has no Wi-Fi".into()))?;
    let status = Command::new("networksetup")
        .args(["-setairportpower", device, if on { "on" } else { "off" }])
        .status()?;
    status
        .success()
        .then_some(())
        .ok_or_else(|| AppError::Platform("Wi-Fi did not switch".into()))
}

// ---- Bluetooth, through IOBluetooth's private power switch ----

#[link(name = "IOBluetooth", kind = "framework")]
extern "C" {
    fn IOBluetoothPreferenceGetControllerPowerState() -> i32;
    fn IOBluetoothPreferenceSetControllerPowerState(state: i32);
}

fn bluetooth() -> Option<bool> {
    // SAFETY: no arguments; returns 0 or 1.
    Some(unsafe { IOBluetoothPreferenceGetControllerPowerState() } != 0)
}

fn set_bluetooth(on: bool) -> AppResult<()> {
    // SAFETY: takes 0 or 1.
    unsafe { IOBluetoothPreferenceSetControllerPowerState(on as i32) };
    Ok(())
}

// ---- Run-time loading of private frameworks and Objective-C ----

extern "C" {
    fn dlopen(path: *const c_char, mode: i32) -> *mut c_void;
    fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
}

#[link(name = "objc")]
extern "C" {
    fn objc_getClass(name: *const c_char) -> *mut c_void;
    fn sel_registerName(name: *const c_char) -> *mut c_void;
    fn objc_msgSend();
}

const RTLD_LAZY: i32 = 1;

/// A function from a framework, or null when the framework or name is missing.
fn symbol(framework: &CStr, name: &CStr) -> *mut c_void {
    // SAFETY: both are NUL-terminated; dlopen keeps the library loaded.
    unsafe {
        let handle = dlopen(framework.as_ptr(), RTLD_LAZY);
        if handle.is_null() {
            return std::ptr::null_mut();
        }
        dlsym(handle, name.as_ptr())
    }
}

/// Sends a message with no arguments that returns an object.
unsafe fn send_id(receiver: *mut c_void, selector: &CStr) -> *mut c_void {
    let f: unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void =
        std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
    f(receiver, sel_registerName(selector.as_ptr()))
}

// ---- Brightness, through DisplayServices ----

type GetBrightness = unsafe extern "C" fn(u32, *mut f32) -> i32;
type SetBrightness = unsafe extern "C" fn(u32, f32) -> i32;

const DISPLAY_SERVICES: &CStr =
    c"/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices";

fn brightness_calls() -> Option<(GetBrightness, SetBrightness)> {
    static CALLS: OnceLock<Option<(usize, usize)>> = OnceLock::new();
    let (get, set) = (*CALLS.get_or_init(|| {
        let get = symbol(DISPLAY_SERVICES, c"DisplayServicesGetBrightness");
        let set = symbol(DISPLAY_SERVICES, c"DisplayServicesSetBrightness");
        (!get.is_null() && !set.is_null()).then_some((get as usize, set as usize))
    }))?;
    // SAFETY: the addresses are these two functions, with these signatures.
    Some(unsafe {
        (
            std::mem::transmute::<usize, GetBrightness>(get),
            std::mem::transmute::<usize, SetBrightness>(set),
        )
    })
}

/// The built-in screen; external screens keep their own buttons.
fn builtin_display() -> Option<u32> {
    CGDisplay::active_displays()
        .ok()?
        .into_iter()
        .find(|&id| CGDisplay::new(id).is_builtin())
}

fn brightness() -> Option<f32> {
    let (get, _) = brightness_calls()?;
    let display = builtin_display()?;
    let mut level = 0f32;
    // SAFETY: `level` receives one f32.
    (unsafe { get(display, &mut level) } == 0).then_some(level)
}

fn set_brightness(level: f32) -> AppResult<()> {
    let unavailable = || AppError::Platform("this screen's brightness can't be set here".into());
    let (_, set) = brightness_calls().ok_or_else(unavailable)?;
    let display = builtin_display().ok_or_else(unavailable)?;
    // SAFETY: plain values.
    (unsafe { set(display, level) } == 0)
        .then_some(())
        .ok_or_else(unavailable)
}

// ---- Dark mode ----

fn dark_mode() -> Option<bool> {
    // The key exists only while dark mode is on.
    Some(output("defaults", &["read", "-g", "AppleInterfaceStyle"]).as_deref() == Some("Dark"))
}

fn set_dark_mode(on: bool) -> AppResult<()> {
    let script = format!(
        "tell application \"System Events\" to tell appearance preferences to set dark mode to {on}"
    );
    let ok = Command::new("osascript")
        .args(["-e", &script])
        .status()?
        .success();
    ok.then_some(()).ok_or_else(|| {
        AppError::Platform(
            "Allow Islet to control System Events in System Settings → Privacy & Security → Automation"
                .into(),
        )
    })
}

// ---- Night Shift, through CoreBrightness's CBBlueLightClient ----

const CORE_BRIGHTNESS: &CStr =
    c"/System/Library/PrivateFrameworks/CoreBrightness.framework/CoreBrightness";

/// One client for the app's life.
fn blue_light_client() -> Option<*mut c_void> {
    static CLIENT: OnceLock<Option<usize>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            // Loading the framework registers the class.
            // SAFETY: NUL-terminated path; the handle stays loaded.
            if unsafe { dlopen(CORE_BRIGHTNESS.as_ptr(), RTLD_LAZY) }.is_null() {
                return None;
            }
            // SAFETY: alloc and init on the class, the usual way to make one.
            unsafe {
                let class = objc_getClass(c"CBBlueLightClient".as_ptr());
                if class.is_null() {
                    return None;
                }
                let client = send_id(send_id(class, c"alloc"), c"init");
                (!client.is_null()).then_some(client as usize)
            }
        })
        .map(|c| c as *mut c_void)
}

fn night_shift() -> Option<bool> {
    let client = blue_light_client()?;
    // The status struct starts { BOOL active; BOOL enabled; ... } and is under
    // 64 bytes; `enabled` is what the Control Center switch shows.
    let mut status = [0u8; 64];
    // SAFETY: getBlueLightStatus: writes the struct into `status`, which is larger.
    let ok = unsafe {
        let f: unsafe extern "C" fn(*mut c_void, *mut c_void, *mut u8) -> u8 =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        f(
            client,
            sel_registerName(c"getBlueLightStatus:".as_ptr()),
            status.as_mut_ptr(),
        )
    };
    (ok != 0).then_some(status[1] != 0)
}

fn set_night_shift(on: bool) -> AppResult<()> {
    let client = blue_light_client()
        .ok_or_else(|| AppError::Platform("Night Shift isn't available on this Mac".into()))?;
    // SAFETY: setEnabled: takes a BOOL and returns one.
    let ok = unsafe {
        let f: unsafe extern "C" fn(*mut c_void, *mut c_void, u8) -> u8 =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        f(client, sel_registerName(c"setEnabled:".as_ptr()), on as u8)
    };
    (ok != 0)
        .then_some(())
        .ok_or_else(|| AppError::Platform("Night Shift did not switch".into()))
}

// ---- Low Power Mode, read from NSProcessInfo (macOS 12 and later) ----

fn low_power() -> Option<bool> {
    // SAFETY: NSProcessInfo.processInfo always exists; the BOOL getter takes no arguments.
    unsafe {
        let info = send_id(objc_getClass(c"NSProcessInfo".as_ptr()), c"processInfo");
        if info.is_null() {
            return None;
        }
        let f: unsafe extern "C" fn(*mut c_void, *mut c_void) -> u8 =
            std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
        Some(f(info, sel_registerName(c"isLowPowerModeEnabled".as_ptr())) != 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_wifi_interface() {
        let ports = "\nHardware Port: Ethernet\nDevice: en1\nEthernet Address: x\n\nHardware Port: Wi-Fi\nDevice: en0\nEthernet Address: y\n";
        assert_eq!(parse_wifi_device(ports).as_deref(), Some("en0"));
        assert_eq!(
            parse_wifi_device("Hardware Port: Thunderbolt Bridge\nDevice: bridge0\n"),
            None
        );
    }

    /// Reads every control on this Mac; run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn reads_this_mac() {
        println!("{:#?}", read());
    }
}
