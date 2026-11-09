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
        }))
    }
}

/// Reads a player's answer: `title<TAB>artist`, or nothing when paused.
// Only the macOS adapter asks desktop players.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn parse_player(app: &str, output: &str) -> Option<NowPlaying> {
    let (title, artist) = output.trim_end_matches(['\n', '\r']).split_once('\t')?;
    let title = clean(title, TITLE_MAX);
    (!title.is_empty()).then(|| NowPlaying {
        title,
        artist: clean(artist, TITLE_MAX),
        app: app.into(),
        image: None,
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
        let np = parse_player("Spotify", "Blinding Lights\tThe Weeknd\n").unwrap();
        assert_eq!(
            (np.title.as_str(), np.artist.as_str(), np.app.as_str()),
            ("Blinding Lights", "The Weeknd", "Spotify")
        );
        assert_eq!(parse_player("Music", "\n"), None);
        assert_eq!(parse_player("Music", "\t\n"), None);
    }
}
