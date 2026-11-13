//! Pairs the browser extension without copying the token by hand.
//!
//! Chromium browsers start a "native messaging host" an extension asks for
//! and talk to it over stdin/stdout: each message is a 4-byte little-endian
//! length, then that much JSON. Lintel registers its own executable as that
//! host (only the Lintel extension may start it), and when started that way it
//! answers with the pairing token and the API port, then exits without
//! opening any window.

use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use serde_json::json;

use crate::core::pairing::TokenStore;
use crate::core::settings_service::SettingsStore;

/// The host's name, as the extension asks for it.
pub const HOST_NAME: &str = "app.lintel.bridge";
/// The extension's ID, fixed by the `key` in `extension/manifest.json`.
pub const EXTENSION_ID: &str = "pgcfcgfilocblloolpoobhigadlpbalk";
/// The app's identifier from `tauri.conf.json`; it names the config folder.
const APP_ID: &str = "app.lintel.desktop";
/// No real request is anywhere near this big.
const MAX_REQUEST: u32 = 64 * 1024;

/// Whether a browser started this process as the native messaging host: it
/// passes the calling extension's origin as an argument.
pub fn requested(args: &[String]) -> bool {
    args.iter().any(|a| a.starts_with("chrome-extension://"))
}

/// Answers the browser, then the process should exit.
pub fn serve() {
    let Some(dir) = config_dir() else { return };
    let reply = match TokenStore::new(dir.clone()).load_or_create() {
        Ok(token) => {
            json!({ "token": token, "port": SettingsStore::new(dir).load().settings.api_port })
        }
        Err(e) => json!({ "error": e.to_string() }),
    };
    let _ = answer(&mut io::stdin().lock(), &mut io::stdout().lock(), &reply);
}

/// Reads one request and writes `reply` in the native messaging framing.
fn answer(
    input: &mut impl Read,
    output: &mut impl Write,
    reply: &serde_json::Value,
) -> io::Result<()> {
    let mut len = [0u8; 4];
    input.read_exact(&mut len)?;
    let len = u32::from_le_bytes(len);
    if len > MAX_REQUEST {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "request too large",
        ));
    }
    // The request says nothing Lintel needs; read it so the browser is not left writing.
    io::copy(&mut input.take(len.into()), &mut io::sink())?;
    let body = serde_json::to_vec(reply)?;
    output.write_all(&(body.len() as u32).to_le_bytes())?;
    output.write_all(&body)?;
    output.flush()
}

/// Where Tauri keeps Lintel's settings and token, found without Tauri running.
fn config_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    let base =
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"));
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(not(any(target_os = "macos", windows)))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")));
    base.map(|b| b.join(APP_ID))
}

/// The host manifest the browsers read, pointing at `exe`.
fn manifest(exe: &Path) -> String {
    let doc = json!({
        "name": HOST_NAME,
        "description": "Pairs the Lintel browser extension with the Lintel app.",
        "path": exe,
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{EXTENSION_ID}/")],
    });
    serde_json::to_string_pretty(&doc).unwrap_or_default()
}

/// Writes `text` unless the file already holds it.
fn write_if_changed(path: &Path, text: &str) -> io::Result<()> {
    if fs::read_to_string(path).is_ok_and(|old| old == text) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, text)
}

/// Registers this executable as the host with every installed Chromium
/// browser, for this user only. Run at each start, so a moved app still pairs.
pub fn register(config_dir: &Path) {
    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(e) => return log::warn!("native host not registered: {e}"),
    };
    let text = manifest(&exe);
    #[cfg(not(windows))]
    {
        let _ = config_dir;
        for dir in browser_dirs() {
            // Only browsers that are installed (their profile folder exists).
            if !dir.exists() {
                continue;
            }
            if let Err(e) = write_if_changed(
                &dir.join("NativeMessagingHosts")
                    .join(format!("{HOST_NAME}.json")),
                &text,
            ) {
                log::warn!("native host not registered in {}: {e}", dir.display());
            }
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Windows browsers find the manifest through the registry; forks such as Vivaldi and Opera read Chrome's key.
        let path = config_dir.join(format!("{HOST_NAME}.json"));
        if let Err(e) = write_if_changed(&path, &text) {
            return log::warn!("native host not registered: {e}");
        }
        for key in [
            "Google\\Chrome",
            "Microsoft\\Edge",
            "BraveSoftware\\Brave-Browser",
            "Chromium",
        ] {
            let status = std::process::Command::new("reg")
                .args([
                    "add",
                    &format!("HKCU\\Software\\{key}\\NativeMessagingHosts\\{HOST_NAME}"),
                    "/ve",
                    "/t",
                    "REG_SZ",
                    "/d",
                ])
                .arg(&path)
                .arg("/f")
                .creation_flags(0x0800_0000) // CREATE_NO_WINDOW: no console flashes up.
                .status();
            if !status.is_ok_and(|s| s.success()) {
                log::warn!("native host not registered for {key}");
            }
        }
    }
}

/// Profile folders of the Chromium browsers, whose `NativeMessagingHosts` they read.
#[cfg(not(windows))]
fn browser_dirs() -> Vec<PathBuf> {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return Vec::new();
    };
    #[cfg(target_os = "macos")]
    let dirs = [
        "Library/Application Support/Google/Chrome",
        "Library/Application Support/Google/Chrome Beta",
        "Library/Application Support/Google/Chrome Dev",
        "Library/Application Support/Google/Chrome Canary",
        "Library/Application Support/Microsoft Edge",
        "Library/Application Support/BraveSoftware/Brave-Browser",
        "Library/Application Support/Chromium",
        "Library/Application Support/Arc/User Data",
        "Library/Application Support/Vivaldi",
    ];
    #[cfg(not(target_os = "macos"))]
    let dirs = [
        ".config/google-chrome",
        ".config/google-chrome-beta",
        ".config/google-chrome-unstable",
        ".config/microsoft-edge",
        ".config/BraveSoftware/Brave-Browser",
        ".config/chromium",
        ".config/vivaldi",
    ];
    dirs.iter().map(|d| home.join(d)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_one_framed_request() {
        let request = br#"{"type":"pair"}"#;
        let mut input = (request.len() as u32).to_le_bytes().to_vec();
        input.extend_from_slice(request);
        let mut out = Vec::new();
        answer(
            &mut input.as_slice(),
            &mut out,
            &json!({ "token": "abc", "port": 47821 }),
        )
        .unwrap();
        let len = u32::from_le_bytes(out[..4].try_into().unwrap()) as usize;
        let reply: serde_json::Value = serde_json::from_slice(&out[4..]).unwrap();
        assert_eq!(len, out.len() - 4);
        assert_eq!(reply["token"], "abc");
        assert_eq!(reply["port"], 47821);
    }

    #[test]
    fn refuses_an_oversized_request() {
        let input = (MAX_REQUEST + 1).to_le_bytes();
        assert!(answer(&mut input.as_slice(), &mut Vec::new(), &json!({})).is_err());
    }

    #[test]
    fn only_the_lintel_extension_may_start_it() {
        let doc: serde_json::Value = serde_json::from_str(&manifest(Path::new(
            "/Applications/Lintel.app/Contents/MacOS/lintel",
        )))
        .unwrap();
        assert_eq!(doc["name"], HOST_NAME);
        assert_eq!(doc["type"], "stdio");
        assert_eq!(
            doc["allowed_origins"],
            json!([format!("chrome-extension://{EXTENSION_ID}/")])
        );
        assert!(requested(&[
            "lintel".into(),
            format!("chrome-extension://{EXTENSION_ID}/")
        ]));
        assert!(!requested(&["lintel".into()]));
    }
}
