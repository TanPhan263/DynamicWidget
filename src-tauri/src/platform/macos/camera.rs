//! Whether some app is using a camera, from CoreMediaIO. Public API; listing
//! cameras needs no camera permission.

use std::ffi::c_void;
use std::mem::size_of;

#[repr(C)]
struct PropertyAddress {
    selector: u32,
    scope: u32,
    element: u32,
}

#[link(name = "CoreMediaIO", kind = "framework")]
extern "C" {
    fn CMIOObjectGetPropertyDataSize(
        object: u32,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: *mut u32,
    ) -> i32;
    fn CMIOObjectGetPropertyData(
        object: u32,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: u32,
        used: *mut u32,
        data: *mut c_void,
    ) -> i32;
}

const SYSTEM_OBJECT: u32 = 1;
const DEVICES: u32 = u32::from_be_bytes(*b"dev#");
const DEVICE_IS_RUNNING_SOMEWHERE: u32 = u32::from_be_bytes(*b"gone");

fn address(selector: u32) -> PropertyAddress {
    PropertyAddress {
        selector,
        scope: u32::from_be_bytes(*b"glob"),
        element: 0,
    }
}

fn devices() -> Vec<u32> {
    let address = address(DEVICES);
    let mut size = 0u32;
    // SAFETY: only the size is written.
    if unsafe {
        CMIOObjectGetPropertyDataSize(SYSTEM_OBJECT, &address, 0, std::ptr::null(), &mut size)
    } != 0
    {
        return Vec::new();
    }
    let mut ids = vec![0u32; size as usize / size_of::<u32>()];
    let mut used = 0u32;
    // SAFETY: `ids` holds `size` bytes, and CoreMediaIO writes at most `size`.
    let status = unsafe {
        CMIOObjectGetPropertyData(
            SYSTEM_OBJECT,
            &address,
            0,
            std::ptr::null(),
            size,
            &mut used,
            ids.as_mut_ptr().cast(),
        )
    };
    if status != 0 {
        return Vec::new();
    }
    ids.truncate(used as usize / size_of::<u32>());
    ids
}

fn running(device: u32) -> bool {
    let address = address(DEVICE_IS_RUNNING_SOMEWHERE);
    let mut value = 0u32;
    let mut used = 0u32;
    // SAFETY: `value` is a u32 and the size passed says so.
    let status = unsafe {
        CMIOObjectGetPropertyData(
            device,
            &address,
            0,
            std::ptr::null(),
            size_of::<u32>() as u32,
            &mut used,
            (&mut value as *mut u32).cast(),
        )
    };
    status == 0 && value != 0
}

/// True while any app has a camera open.
pub fn in_use() -> bool {
    devices().into_iter().any(running)
}

#[cfg(test)]
mod tests {
    /// Asks the real cameras; run with `cargo test -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn lists_cameras() {
        // A Mac mini with nothing plugged in has none.
        println!(
            "cameras: {:?}, in use: {}",
            super::devices(),
            super::in_use()
        );
    }
}
