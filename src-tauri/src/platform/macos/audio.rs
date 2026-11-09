//! Whether sound is playing, from CoreAudio. Public API, no permission.

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
    fn AudioObjectGetPropertyData(
        object: u32,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: *mut u32,
        data: *mut c_void,
    ) -> i32;
}

const SYSTEM_OBJECT: u32 = 1;
const SCOPE_GLOBAL: u32 = u32::from_be_bytes(*b"glob");
const DEFAULT_OUTPUT_DEVICE: u32 = u32::from_be_bytes(*b"dOut");
const DEVICE_IS_RUNNING_SOMEWHERE: u32 = u32::from_be_bytes(*b"gone");

fn read_u32(object: u32, selector: u32) -> Option<u32> {
    let address = PropertyAddress {
        selector,
        scope: SCOPE_GLOBAL,
        element: 0,
    };
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

#[cfg(test)]
mod tests {
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
