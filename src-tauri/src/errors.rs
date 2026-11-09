use serde::{Serialize, Serializer};

/// Normalized application error. Every error that crosses the IPC boundary is
/// serialized as `{ code, message }` so the UI can react to the category.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("settings storage failed: {0}")]
    Settings(String),
    #[error("{0}")]
    Shortcut(String),
    #[error("platform operation failed: {0}")]
    Platform(String),
    #[error("{0}")]
    Api(String),
    #[error("start at login failed: {0}")]
    Autostart(String),
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("internal error: {0}")]
    Tauri(#[from] tauri::Error),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Validation(_) => "validation",
            AppError::Settings(_) => "settings",
            AppError::Shortcut(_) => "shortcut",
            AppError::Platform(_) => "platform",
            AppError::Api(_) => "api",
            AppError::Autostart(_) => "autostart",
            AppError::Io(_) => "io",
            AppError::Tauri(_) => "internal",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_code_and_message() {
        let err = AppError::Validation("Title is required".into());
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "validation");
        assert_eq!(json["message"], "Title is required");
    }

    #[test]
    fn maps_io_errors() {
        let err: AppError = std::io::Error::other("disk full").into();
        assert_eq!(err.code(), "io");
        assert!(err.to_string().contains("disk full"));
    }
}
