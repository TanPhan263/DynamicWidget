//! What is playing now, for the title beside the music bars. Websites report
//! it through the browser extension; desktop players are asked by the
//! platform adapter.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::notifications::{check_image, clean, APP_MAX, TITLE_MAX};
use crate::errors::AppResult;

/// The extension repeats its report every few seconds while playing; one
/// older than this is stale (the tab closed or the browser quit).
pub const WEB_FRESH: Duration = Duration::from_secs(8);

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    /// The player or website, such as "Spotify" or "YouTube".
    pub app: String,
    /// A small picture: the website's icon or the cover.
    pub image: Option<String>,
    /// Islet can play, pause and skip it (see [`MediaCommand`]).
    pub controls: bool,
    /// A website reported it; its buttons go to the extension.
    pub browser: bool,
}

/// What the Now playing widget's buttons ask the player to do.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MediaCommand {
    PlayPause,
    Next,
    Previous,
}

/// What the browser extension sends to `POST /v1/media`.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct MediaInput {
    pub title: String,
    pub artist: Option<String>,
    pub app: Option<String>,
    pub image: Option<String>,
    pub playing: bool,
}

impl MediaInput {
    /// `None` when nothing plays; an error for a bad image.
    pub fn now_playing(self) -> AppResult<Option<NowPlaying>> {
        let title = clean(&self.title, TITLE_MAX);
        if !self.playing || title.is_empty() {
            return Ok(None);
        }
        let image = match self
            .image
            .as_deref()
            .map(str::trim)
            .filter(|i| !i.is_empty())
        {
            Some(i) => Some(check_image(i)?),
            None => None,
        };
        Ok(Some(NowPlaying {
            title,
            artist: clean(self.artist.as_deref().unwrap_or(""), TITLE_MAX),
            app: clean(self.app.as_deref().unwrap_or("Browser"), APP_MAX),
            image,
            // The extension plays, pauses and skips in the tab.
            controls: true,
            browser: true,
        }))
    }
}

/// Reads a player's answer: `title<TAB>artist[<TAB>artwork url]`, or
/// nothing when paused. The URL comes back separately, to be fetched.
// Only the macOS adapter asks players this way.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn parse_player(app: &str, output: &str) -> Option<(NowPlaying, Option<String>)> {
    let mut parts = output.trim_end_matches(['\n', '\r']).splitn(3, '\t');
    let (title, artist) = (parts.next()?, parts.next()?);
    let art = parts
        .next()
        .map(str::trim)
        .filter(|u| u.starts_with("https://"));
    Some((track(app, title, artist)?, art.map(String::from)))
}

/// A desktop player's track, or `None` without a title.
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
pub fn track(app: &str, title: &str, artist: &str) -> Option<NowPlaying> {
    let title = clean(title, TITLE_MAX);
    (!title.is_empty()).then(|| NowPlaying {
        title,
        artist: clean(artist, TITLE_MAX),
        app: clean(app, APP_MAX),
        image: None,
        controls: true,
        browser: false,
    })
}

/// A readable app name from a Windows media session's app id, such as
/// `Spotify.exe`, `MSEdge` or `Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic`.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn app_from_aumid(id: &str) -> String {
    // Store apps are `Package_publisher!App`; desktop apps an exe or a name.
    let name = id.rsplit(['!', '\\']).next().unwrap_or(id);
    let name = name
        .strip_suffix(".exe")
        .or(name.strip_suffix(".EXE"))
        .unwrap_or(name);
    let known = [
        ("spotify", "Spotify"),
        ("chrome", "Chrome"),
        ("msedge", "Edge"),
        ("firefox", "Firefox"),
        ("brave", "Brave"),
        ("opera", "Opera"),
        ("microsoft.zunemusic", "Media Player"),
        ("microsoft.media.player", "Media Player"),
        ("vlc", "VLC"),
        ("itunes", "iTunes"),
        ("applemusic", "Apple Music"),
    ];
    let lower = name.to_ascii_lowercase();
    known
        .iter()
        .find(|(k, _)| lower == *k || lower.ends_with(&format!(".{k}")))
        .map(|(_, v)| (*v).to_string())
        .unwrap_or_else(|| {
            if name.is_empty() {
                "Media".into()
            } else {
                name.to_string()
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_reports_become_now_playing() {
        let input = MediaInput {
            title: "  Lofi beats\n".into(),
            artist: Some("Chill".into()),
            app: Some("YouTube".into()),
            image: None,
            playing: true,
        };
        let np = input.clone().now_playing().unwrap().unwrap();
        assert_eq!(
            (np.title.as_str(), np.artist.as_str(), np.app.as_str()),
            ("Lofi beats", "Chill", "YouTube")
        );
        let paused = MediaInput {
            playing: false,
            ..input.clone()
        };
        assert_eq!(paused.now_playing().unwrap(), None);
        let bad = MediaInput {
            image: Some("https://x/y.png".into()),
            ..input
        };
        assert!(bad.now_playing().is_err());
    }

    #[test]
    fn player_output_is_parsed() {
        let (np, art) = parse_player("Music", "Blinding Lights\tThe Weeknd\n").unwrap();
        assert_eq!(
            (
                np.title.as_str(),
                np.artist.as_str(),
                np.app.as_str(),
                np.controls
            ),
            ("Blinding Lights", "The Weeknd", "Music", true)
        );
        assert_eq!(art, None);
        let (_, art) = parse_player("Spotify", "A\tB\thttps://i.scdn.co/image/ab67\n").unwrap();
        assert_eq!(art.as_deref(), Some("https://i.scdn.co/image/ab67"));
        let (_, art) = parse_player("Spotify", "A\tB\tfile:///etc/passwd\n").unwrap();
        assert_eq!(art, None, "only https artwork is fetched");
        assert_eq!(parse_player("Music", "\n"), None);
        assert_eq!(parse_player("Music", "\t\n"), None);
    }

    #[test]
    fn windows_app_ids_become_names() {
        assert_eq!(app_from_aumid("Spotify.exe"), "Spotify");
        assert_eq!(app_from_aumid("MSEdge"), "Edge");
        assert_eq!(app_from_aumid("Chrome"), "Chrome");
        assert_eq!(
            app_from_aumid("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"),
            "Media Player"
        );
        assert_eq!(app_from_aumid("C:\\Apps\\foobar2000.exe"), "foobar2000");
        assert_eq!(app_from_aumid(""), "Media");
    }
}
