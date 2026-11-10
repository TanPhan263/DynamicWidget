//! Whether some app is using the camera or microphone. Windows records each
//! app's use under the privacy settings' ConsentStore; an entry whose last
//! stop time is 0 is in use right now. No permission needed.

use windows::core::{HSTRING, PWSTR};
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::{
    RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
    RRF_RT_REG_QWORD,
};

const STORE: &str =
    r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";

struct Key(HKEY);

impl Drop for Key {
    fn drop(&mut self) {
        // SAFETY: the key was opened by `open` and is closed once.
        let _ = unsafe { RegCloseKey(self.0) };
    }
}

fn open(parent: HKEY, path: &str) -> Option<Key> {
    let mut key = HKEY::default();
    // SAFETY: `key` receives the handle, which `Key` closes.
    let status =
        unsafe { RegOpenKeyExW(parent, &HSTRING::from(path), Some(0), KEY_READ, &mut key) };
    (status == ERROR_SUCCESS).then_some(Key(key))
}

fn subkeys(key: &Key) -> Vec<String> {
    let mut names = Vec::new();
    for index in 0.. {
        let mut buf = [0u16; 512];
        let mut len = buf.len() as u32;
        // SAFETY: `buf` holds `len` UTF-16 units.
        let status = unsafe {
            RegEnumKeyExW(
                key.0,
                index,
                Some(PWSTR(buf.as_mut_ptr())),
                &mut len,
                None,
                None,
                None,
                None,
            )
        };
        if status != ERROR_SUCCESS {
            break;
        }
        names.push(String::from_utf16_lossy(&buf[..len as usize]));
    }
    names
}

fn qword(key: &Key, sub: &str, value: &str) -> Option<u64> {
    let mut data = 0u64;
    let mut size = size_of::<u64>() as u32;
    // SAFETY: `data` is a u64 and `size` says so.
    let status = unsafe {
        RegGetValueW(
            key.0,
            &HSTRING::from(sub),
            &HSTRING::from(value),
            RRF_RT_REG_QWORD,
            None,
            Some((&mut data as *mut u64).cast()),
            Some(&mut size),
        )
    };
    (status == ERROR_SUCCESS).then_some(data)
}

/// Started at some point and not stopped since.
fn active(start: Option<u64>, stop: Option<u64>) -> bool {
    start.is_some_and(|s| s > 0) && stop == Some(0)
}

fn any_active(key: &Key, sub: &str) -> bool {
    active(
        qword(key, sub, "LastUsedTimeStart"),
        qword(key, sub, "LastUsedTimeStop"),
    )
}

/// `capability` is "webcam" or "microphone".
// shortcut: reads only the current user's store, where apps run by the user
// are recorded; add HKEY_LOCAL_MACHINE if services using a camera matter.
pub fn in_use(capability: &str) -> bool {
    let Some(store) = open(HKEY_CURRENT_USER, &format!(r"{STORE}\{capability}")) else {
        return false;
    };
    subkeys(&store).iter().any(|app| {
        if app == "NonPackaged" {
            // Desktop programs sit one level down, keyed by their path.
            open(store.0, app)
                .is_some_and(|desktop| subkeys(&desktop).iter().any(|p| any_active(&desktop, p)))
        } else {
            any_active(&store, app)
        }
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn in_use_until_stopped() {
        assert!(super::active(Some(5), Some(0)));
        assert!(!super::active(Some(5), Some(9)), "stopped");
        assert!(!super::active(None, Some(0)), "never started");
        assert!(!super::active(Some(5), None));
    }
}
