//! Whether sound is playing or a microphone is recording, from CoreAudio.
//! Public API, no permission.

use std::ffi::c_void;
use std::mem::size_of;

#[repr(C)]
struct PropertyAddress {
    selector: u32,
    scope: u32,
    element: u32,
}

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectSetPropertyData(
        object: u32,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: u32,
        data: *const c_void,
    ) -> i32;
    fn AudioObjectGetPropertyData(
        object: u32,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: *mut u32,
        data: *mut c_void,
    ) -> i32;
    fn AudioObjectGetPropertyDataSize(
        object: u32,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: *mut u32,
    ) -> i32;
}

// The output's overall volume lives behind AudioToolbox's hardware service.
#[link(name = "AudioToolbox", kind = "framework")]
extern "C" {
    fn AudioHardwareServiceGetPropertyData(
        object: u32,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: *mut u32,
        data: *mut c_void,
    ) -> i32;
    fn AudioHardwareServiceSetPropertyData(
        object: u32,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: u32,
        data: *const c_void,
    ) -> i32;
}

const SYSTEM_OBJECT: u32 = 1;
const SCOPE_OUTPUT: u32 = u32::from_be_bytes(*b"outp");
const VIRTUAL_MAIN_VOLUME: u32 = u32::from_be_bytes(*b"vmvc");
const DEVICE_MUTE: u32 = u32::from_be_bytes(*b"mute");
const SCOPE_GLOBAL: u32 = u32::from_be_bytes(*b"glob");
const DEFAULT_OUTPUT_DEVICE: u32 = u32::from_be_bytes(*b"dOut");
const DEFAULT_INPUT_DEVICE: u32 = u32::from_be_bytes(*b"dIn ");
const DEVICE_IS_RUNNING_SOMEWHERE: u32 = u32::from_be_bytes(*b"gone");
/// macOS 14 and later list the processes using audio.
const PROCESS_OBJECT_LIST: u32 = u32::from_be_bytes(*b"prs#");
const PROCESS_IS_RUNNING_INPUT: u32 = u32::from_be_bytes(*b"piri");

fn global(selector: u32) -> PropertyAddress {
    PropertyAddress {
        selector,
        scope: SCOPE_GLOBAL,
        element: 0,
    }
}

/// An array of object ids, such as every process using audio.
fn read_ids(object: u32, selector: u32) -> Option<Vec<u32>> {
    let address = global(selector);
    let mut size = 0u32;
    // SAFETY: only the size is written.
    let status =
        unsafe { AudioObjectGetPropertyDataSize(object, &address, 0, std::ptr::null(), &mut size) };
    if status != 0 {
        return None;
    }
    let mut ids = vec![0u32; size as usize / size_of::<u32>()];
    // SAFETY: `ids` holds `size` bytes, and CoreAudio writes at most `size`.
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            &address,
            0,
            std::ptr::null(),
            &mut size,
            ids.as_mut_ptr().cast(),
        )
    };
    ids.truncate(size as usize / size_of::<u32>());
    (status == 0).then_some(ids)
}

fn read_u32(object: u32, selector: u32) -> Option<u32> {
    let address = global(selector);
    let mut value = 0u32;
    let mut size = size_of::<u32>() as u32;
    // SAFETY: `value` is a u32 and `size` says so; CoreAudio writes at most that.
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            &address,
            0,
            std::ptr::null(),
            &mut size,
            (&mut value as *mut u32).cast(),
        )
    };
    (status == 0).then_some(value)
}

/// True while any process is playing to the default output device.
// shortcut: an app that keeps the device open while paused (some browsers,
// call apps) counts as playing; read real levels if that shows up.
pub fn output_running() -> bool {
    read_u32(SYSTEM_OBJECT, DEFAULT_OUTPUT_DEVICE)
        .and_then(|device| read_u32(device, DEVICE_IS_RUNNING_SOMEWHERE))
        .is_some_and(|running| running != 0)
}

fn output(selector: u32) -> PropertyAddress {
    PropertyAddress {
        selector,
        scope: SCOPE_OUTPUT,
        element: 0,
    }
}

/// The default output's volume, 0 to 1; `None` for outputs without one (HDMI).
pub fn volume() -> Option<f32> {
    let device = read_u32(SYSTEM_OBJECT, DEFAULT_OUTPUT_DEVICE)?;
    let mut value = 0f32;
    let mut size = size_of::<f32>() as u32;
    // SAFETY: `value` is an f32 and `size` says so.
    let status = unsafe {
        AudioHardwareServiceGetPropertyData(
            device,
            &output(VIRTUAL_MAIN_VOLUME),
            0,
            std::ptr::null(),
            &mut size,
            (&mut value as *mut f32).cast(),
        )
    };
    (status == 0).then_some(value)
}

pub fn set_volume(level: f32) -> bool {
    let Some(device) = read_u32(SYSTEM_OBJECT, DEFAULT_OUTPUT_DEVICE) else {
        return false;
    };
    // SAFETY: CoreAudio reads one f32.
    let status = unsafe {
        AudioHardwareServiceSetPropertyData(
            device,
            &output(VIRTUAL_MAIN_VOLUME),
            0,
            std::ptr::null(),
            size_of::<f32>() as u32,
            (&level as *const f32).cast(),
        )
    };
    // Raising the volume of a muted output unmutes it, like the volume keys.
    if status == 0 && level > 0.0 && muted() == Some(true) {
        let off = 0u32;
        // SAFETY: CoreAudio reads one u32.
        unsafe {
            AudioObjectSetPropertyData(
                device,
                &output(DEVICE_MUTE),
                0,
                std::ptr::null(),
                size_of::<u32>() as u32,
                (&off as *const u32).cast(),
            )
        };
    }
    status == 0
}

pub fn muted() -> Option<bool> {
    let device = read_u32(SYSTEM_OBJECT, DEFAULT_OUTPUT_DEVICE)?;
    let mut value = 0u32;
    let mut size = size_of::<u32>() as u32;
    // SAFETY: `value` is a u32 and `size` says so.
    let status = unsafe {
        AudioObjectGetPropertyData(
            device,
            &output(DEVICE_MUTE),
            0,
            std::ptr::null(),
            &mut size,
            (&mut value as *mut u32).cast(),
        )
    };
    (status == 0).then_some(value != 0)
}

/// True while some app records from a microphone.
pub fn input_running() -> bool {
    match read_ids(SYSTEM_OBJECT, PROCESS_OBJECT_LIST) {
        Some(processes) => processes
            .into_iter()
            .any(|p| read_u32(p, PROCESS_IS_RUNNING_INPUT).is_some_and(|r| r != 0)),
        // shortcut: before macOS 14 only the whole device can be asked, so a
        // headset playing music counts as recording; fine for old systems.
        None => read_u32(SYSTEM_OBJECT, DEFAULT_INPUT_DEVICE)
            .and_then(|device| read_u32(device, DEVICE_IS_RUNNING_SOMEWHERE))
            .is_some_and(|running| running != 0),
    }
}

#[cfg(test)]
mod tests {
    /// The per-process list exists on macOS 14 and later; run with `--ignored`.
    #[test]
    #[ignore]
    fn lists_audio_processes() {
        let processes = super::read_ids(super::SYSTEM_OBJECT, super::PROCESS_OBJECT_LIST);
        assert!(processes.is_some_and(|p| !p.is_empty()));
        println!("microphone in use: {}", super::input_running());
    }

    /// Plays a sound with `afplay`; run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn sees_sound_playing() {
        let mut player = std::process::Command::new("afplay")
            .args(["-v", "0.05", "/System/Library/Sounds/Submarine.aiff"])
            .spawn()
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        let during = super::output_running();
        player.wait().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1500));
        assert!(during, "sound was playing");
        assert!(
            !super::output_running(),
            "stopped after the sound (fails if other audio plays)"
        );
    }
}
