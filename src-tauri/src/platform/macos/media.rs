//! The track playing in Spotify or Apple Music, asked with AppleScript.
//! macOS asks the person once to let Lintel control each player.

use std::io::Read;
use std::process::Command;
use std::sync::Mutex;

use base64::Engine;

use crate::core::market;
use crate::core::media::{parse_player, MediaCommand, NowPlaying};
use crate::errors::{AppError, AppResult};

/// Player name, process name, AppleScript application id, and the extra
/// fields its script returns after `title<TAB>artist`.
const PLAYERS: [(&str, &str, &str, &str); 2] = [
    (
        "Spotify",
        "Spotify",
        "com.spotify.client",
        " & tab & (artwork url of current track)",
    ),
    // Music has no artwork URL; its cover is written to a file instead.
    ("Music", "Music", "com.apple.Music", ""),
];

/// Covers bigger than this are left out; Spotify's 640 px JPEGs are ~100 KiB.
const ART_MAX: u64 = 300 * 1024;

/// The last track's cover key (artwork URL, or the Music track) and what it
/// became, so each cover loads once.
static ART: Mutex<Option<(String, Option<String>)>> = Mutex::new(None);

fn osascript(script: &str) -> Option<std::process::Output> {
    Command::new("osascript").args(["-e", script]).output().ok()
}

/// Only running players are asked, so a query never launches one.
pub fn now_playing() -> Option<NowPlaying> {
    PLAYERS.iter().find_map(|(name, process, id, extra)| {
        let running = Command::new("pgrep").args(["-xq", process]).status().ok()?.success();
        if !running {
            return None;
        }
        let script = format!(
            r#"tell application id "{id}" to if player state is playing then return (name of current track) & tab & (artist of current track){extra}"#
        );
        let out = osascript(&script)?;
        if !out.status.success() {
            // Often -1743: Lintel is not allowed to control this player.
            log::warn!("{name} query failed: {}", String::from_utf8_lossy(&out.stderr).trim());
        }
        let (mut np, art) = parse_player(name, &String::from_utf8_lossy(&out.stdout))?;
        np.image = match art {
            Some(url) => cached(&url, || download(&url)),
            None if *name == "Music" => cached(&format!("music\n{}\n{}", np.title, np.artist), music_cover),
            None => None,
        };
        Some(np)
    })
}

fn cached(key: &str, load: impl FnOnce() -> Option<String>) -> Option<String> {
    let mut cache = ART.lock().ok()?;
    if let Some((cached, image)) = cache.as_ref() {
        if cached == key {
            return image.clone();
        }
    }
    let image = load();
    *cache = Some((key.to_string(), image.clone()));
    image
}

/// Music's cover: AppleScript writes the artwork's raw bytes to a temporary file.
fn music_cover() -> Option<String> {
    let path = std::env::temp_dir().join("lintel-music-cover");
    let script = format!(
        r#"tell application id "com.apple.Music" to set d to raw data of artwork 1 of current track
set f to open for access (POSIX file "{}") with write permission
set eof f to 0
write d to f
close access f"#,
        path.display()
    );
    let ok = osascript(&script).is_some_and(|o| o.status.success());
    let bytes = std::fs::read(&path).ok();
    let _ = std::fs::remove_file(&path);
    let bytes = bytes.filter(|b| ok && !b.is_empty() && b.len() as u64 <= ART_MAX)?;
    let kind = image_kind(&bytes)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{kind};base64,{b64}"))
}

/// The type of a cover from its first bytes; anything else is not shown.
fn image_kind(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG") {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else {
        None
    }
}

/// The cover as a data URL; the page may only show `data:` images.
fn download(url: &str) -> Option<String> {
    let res = market::agent().get(url).call().ok()?;
    let kind = res.content_type().to_string();
    if !kind.starts_with("image/") {
        return None;
    }
    let mut bytes = Vec::new();
    res.into_reader()
        .take(ART_MAX + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > ART_MAX {
        return None;
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{kind};base64,{b64}"))
}

pub fn control(player: &str, command: MediaCommand) -> AppResult<()> {
    let id = PLAYERS
        .iter()
        .find(|(name, ..)| *name == player)
        .map(|(_, _, id, _)| id)
        .ok_or_else(|| AppError::Validation(format!("{player} can't be controlled from Lintel")))?;
    let verb = match command {
        MediaCommand::PlayPause => "playpause",
        MediaCommand::Next => "next track",
        MediaCommand::Previous => "previous track",
    };
    let out = osascript(&format!(r#"tell application id "{id}" to {verb}"#))
        .ok_or_else(|| AppError::Platform("osascript did not run".into()))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(AppError::Platform(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn covers_are_png_or_jpeg_only() {
        assert_eq!(image_kind(b"\x89PNG\r\n\x1a\n...."), Some("image/png"));
        assert_eq!(image_kind(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(image_kind(b"<html>"), None);
    }

    #[test]
    fn each_cover_loads_once() {
        let mut loads = 0;
        let key = "test\nonce";
        for _ in 0..3 {
            let image = cached(key, || {
                loads += 1;
                Some("data:image/png;base64,AA==".into())
            });
            assert!(image.is_some());
        }
        assert_eq!(loads, 1);
    }
}
