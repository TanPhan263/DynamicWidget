// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if lintel_lib::serve_native_host_if_asked() {
        return;
    }
    lintel_lib::run()
}
