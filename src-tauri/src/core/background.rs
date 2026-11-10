//! The pictures a user chose as backgrounds: one for the wide open panel and
//! one for the thin floating island. Kept as files beside settings.json, so
//! settings stay small and quick to send around.

use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};

/// Settings shrinks pictures to 1600 px wide JPEGs; this leaves room for PNGs.
const MAX_BYTES: usize = 3 * 1024 * 1024;

/// Which background a picture is for; their shapes differ a lot.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Slot {
    /// The open panel. Its file keeps the name from when there was one picture.
    Panel,
    /// The closed floating island; it falls back to the panel's picture.
    Island,
}

pub fn path(settings_dir: &Path, slot: Slot) -> PathBuf {
    settings_dir.join(match slot {
        Slot::Panel => "background.img",
        Slot::Island => "background-island.img",
    })
}

/// "image/jpeg" or "image/png" from the file's first bytes, else None.
fn kind(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else {
        None
    }
}

/// The picture's bytes from a `data:image/...;base64,` URL the page sent.
pub fn decode(data_url: &str) -> AppResult<Vec<u8>> {
    let invalid = |why: &str| AppError::Validation(format!("background picture: {why}"));
    let (head, body) = data_url
        .split_once(',')
        .ok_or_else(|| invalid("not a data URL"))?;
    if !head.starts_with("data:image/") || !head.ends_with(";base64") {
        return Err(invalid("not a base64 image"));
    }
    // Base64 is 4/3 of the bytes; refuse before decoding something huge.
    if body.len() > MAX_BYTES / 3 * 4 + 4 {
        return Err(invalid("larger than 3 MB"));
    }
    let bytes = STANDARD
        .decode(body)
        .map_err(|_| invalid("broken base64"))?;
    kind(&bytes).ok_or_else(|| invalid("only JPEG and PNG pictures work"))?;
    Ok(bytes)
}

/// Saves the picture, or removes it when `None`.
pub fn save(file: &Path, bytes: Option<&[u8]>) -> AppResult<()> {
    match bytes {
        Some(b) => fs::write(file, b)
            .map_err(|e| AppError::Settings(format!("saving the background picture failed: {e}"))),
        None => match fs::remove_file(file) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(AppError::Settings(format!(
                "removing the background picture failed: {e}"
            ))),
            _ => Ok(()),
        },
    }
}

/// The saved picture as a data URL for the pages (their CSP allows `data:`).
pub fn load(file: &Path) -> Option<String> {
    let bytes = fs::read(file).ok()?;
    let mime = kind(&bytes)?;
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n rest";

    #[test]
    fn round_trips_a_picture() {
        let dir = std::env::temp_dir().join(format!("lintel-bg-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = path(&dir, Slot::Panel);
        assert_ne!(file, path(&dir, Slot::Island));
        let url = format!("data:image/png;base64,{}", STANDARD.encode(PNG));
        save(&file, Some(&decode(&url).unwrap())).unwrap();
        assert_eq!(load(&file).as_deref(), Some(url.as_str()));
        save(&file, None).unwrap();
        assert_eq!(load(&file), None);
        save(&file, None).unwrap();
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_what_is_not_a_picture() {
        assert!(decode("hello").is_err());
        assert!(decode("data:text/html;base64,PGgxPg==").is_err());
        let gif = format!("data:image/gif;base64,{}", STANDARD.encode(b"GIF89a"));
        assert!(decode(&gif).is_err(), "only JPEG and PNG");
        let huge = format!("data:image/png;base64,{}", "A".repeat(MAX_BYTES * 2));
        assert!(decode(&huge).is_err());
    }
}
