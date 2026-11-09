//! Global shortcut that opens and closes the island panel.
//!
//! Registration is transactional: if a new shortcut cannot be registered,
//! the previous one is restored.

use std::str::FromStr;

use tauri::{AppHandle, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::errors::{AppError, AppResult};

pub type Dispatch<R> = fn(&AppHandle<R>);

pub fn parse(accelerator: &str) -> AppResult<Shortcut> {
    Shortcut::from_str(accelerator.trim())
        .map_err(|e| AppError::Validation(format!("Shortcut \"{accelerator}\" is invalid: {e}")))
}

#[derive(Default)]
pub struct ShortcutService {
    current: Option<Shortcut>,
}

impl ShortcutService {
    /// Registers `accelerator`, replacing the current shortcut. On failure the
    /// previous shortcut stays active and an error describing the conflict is
    /// returned.
    pub fn apply<R: Runtime>(
        &mut self,
        app: &AppHandle<R>,
        accelerator: &str,
        dispatch: Dispatch<R>,
    ) -> AppResult<()> {
        let next = parse(accelerator)?;
        if self.current.map(|s| s.id()) == Some(next.id()) {
            return Ok(());
        }

        let old = self.current.take();
        if let Some(s) = old {
            if let Err(e) = app.global_shortcut().unregister(s) {
                log::warn!("unregister shortcut failed: {e}");
            }
        }

        match Self::register(app, next, dispatch) {
            Ok(()) => {
                self.current = Some(next);
                log::info!("global shortcut registered");
                Ok(())
            }
            Err(e) => {
                if let Some(s) = old {
                    match Self::register(app, s, dispatch) {
                        Ok(()) => self.current = Some(s),
                        Err(e2) => log::error!("could not restore previous shortcut: {e2}"),
                    }
                }
                Err(e)
            }
        }
    }

    fn register<R: Runtime>(
        app: &AppHandle<R>,
        s: Shortcut,
        dispatch: Dispatch<R>,
    ) -> AppResult<()> {
        app.global_shortcut()
            .on_shortcut(s, move |app, _, event| {
                if event.state == ShortcutState::Pressed {
                    dispatch(app);
                }
            })
            .map_err(|e| {
                AppError::Shortcut(format!(
                    "Shortcut is unavailable (it may be used by another app): {e}"
                ))
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shortcut_is_valid() {
        assert!(parse("CommandOrControl+Shift+Space").is_ok());
    }

    #[test]
    fn spellings_of_the_same_shortcut_match() {
        assert_eq!(
            parse("CmdOrCtrl+Shift+Space").unwrap().id(),
            parse("CommandOrControl+Shift+Space").unwrap().id()
        );
    }

    #[test]
    fn invalid_accelerator_is_rejected() {
        let err = parse("Shift+Banana").unwrap_err();
        assert_eq!(err.code(), "validation");
        assert!(parse("").is_err());
    }
}
