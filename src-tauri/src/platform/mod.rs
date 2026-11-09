pub mod adapter;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod generic;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

pub use adapter::PlatformAdapter;

pub fn create_adapter() -> Box<dyn PlatformAdapter> {
    #[cfg(target_os = "macos")]
    return Box::new(macos::MacAdapter);
    #[cfg(target_os = "windows")]
    return Box::new(windows::WindowsAdapter);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return Box::new(generic::GenericAdapter);
}

pub fn platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "other"
    }
}
