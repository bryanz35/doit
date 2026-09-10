#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("filesystem: {0}")]
    Io(#[from] std::io::Error),

    #[error("tauri: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("no task with id {0}")]
    NotFound(String),

    #[error("{0}")]
    Invalid(String),

    #[error("database lock panic")]
    Lock,
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
