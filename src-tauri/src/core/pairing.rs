//! The token that pairs the Lintel browser extension with the local API.
//! It lives in its own file next to the settings, so resetting settings
//! does not unpair the browser.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use crate::errors::{AppError, AppResult};

const TOKEN_FILE: &str = "browser-token";
/// 16 random bytes, written as hex.
const TOKEN_LEN: usize = 32;

pub fn new_token() -> AppResult<String> {
    let mut bytes = [0u8; TOKEN_LEN / 2];
    getrandom::fill(&mut bytes).map_err(|e| AppError::Settings(format!("no randomness: {e}")))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

pub fn is_valid(token: &str) -> bool {
    token.len() == TOKEN_LEN && token.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Compares in time independent of where the first difference is.
pub fn matches(given: &str, expected: &str) -> bool {
    if !is_valid(expected) || given.len() != expected.len() {
        return false;
    }
    given
        .bytes()
        .zip(expected.bytes())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

#[derive(Debug, Clone)]
pub struct TokenStore {
    dir: PathBuf,
}

impl TokenStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn path(&self) -> PathBuf {
        self.dir.join(TOKEN_FILE)
    }

    /// The saved token, or a new one when there is none yet.
    pub fn load_or_create(&self) -> AppResult<String> {
        match fs::read_to_string(self.path()) {
            Ok(raw) if is_valid(raw.trim()) => Ok(raw.trim().to_string()),
            _ => self.replace(),
        }
    }

    /// Writes a new token, which unpairs any browser using the old one.
    /// It goes to a temporary file first, so a crash never leaves half a
    /// token behind.
    pub fn replace(&self) -> AppResult<String> {
        let token = new_token()?;
        fs::create_dir_all(&self.dir)?;
        let tmp = self.dir.join(format!("{TOKEN_FILE}.tmp"));
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut f = options.open(&tmp)?;
        f.write_all(token.as_bytes())?;
        f.sync_all()?;
        fs::rename(&tmp, self.path())?;
        Ok(token)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_random_hex() {
        let a = new_token().unwrap();
        let b = new_token().unwrap();
        assert!(is_valid(&a));
        assert_ne!(a, b);
    }

    #[test]
    fn matching_needs_the_exact_token() {
        let t = new_token().unwrap();
        assert!(matches(&t, &t));
        assert!(!matches(&t[1..], &t));
        let mut wrong = t.clone();
        wrong.replace_range(0..1, if t.starts_with('0') { "1" } else { "0" });
        assert!(!matches(&wrong, &t));
        // An unpaired (empty) token matches nothing, not even itself.
        assert!(!matches("", ""));
    }

    #[test]
    fn store_keeps_and_replaces_the_token() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let store = TokenStore::new(std::env::temp_dir().join(format!("lintel-test-token-{ts}")));
        let first = store.load_or_create().unwrap();
        assert_eq!(store.load_or_create().unwrap(), first);
        let second = store.replace().unwrap();
        assert_ne!(second, first);
        assert_eq!(store.load_or_create().unwrap(), second);
    }
}
