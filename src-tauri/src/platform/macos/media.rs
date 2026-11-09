//! The track playing in Spotify or Apple Music, asked with AppleScript.
//! macOS asks the person once to let Islet control each player.

use std::process::Command;

use crate::core::media::{parse_player, NowPlaying};

/// Player name, process name, and its AppleScript application id.
const PLAYERS: [(&str, &str, &str); 2] = [
    ("Spotify", "Spotify", "com.spotify.client"),
    ("Music", "Music", "com.apple.Music"),
];

/// Only running players are asked, so a query never launches one.
pub fn now_playing() -> Option<NowPlaying> {
    PLAYERS.iter().find_map(|(name, process, id)| {
        let running = Command::new("pgrep").args(["-xq", process]).status().ok()?.success();
        if !running {
            return None;
        }
        let script = format!(
            r#"tell application id "{id}" to if player state is playing then return (name of current track) & tab & (artist of current track)"#
        );
        let out = Command::new("osascript").args(["-e", &script]).output().ok()?;
        parse_player(name, &String::from_utf8_lossy(&out.stdout))
    })
}
