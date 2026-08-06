pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("network error: {0}")]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Msg(String),
}

impl Error {
    pub fn msg(m: impl Into<String>) -> Self {
        Error::Msg(m.into())
    }
}

// Tauri commands surface errors to JS as strings. Include the source
// chain — reqwest's Display alone says "error sending request" while the
// actual cause (DNS, TLS certificate, timeout…) hides in the sources.
impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut msg = self.to_string();
        let mut source = std::error::Error::source(self);
        while let Some(s) = source {
            msg.push_str(&format!(" — {s}"));
            source = s.source();
        }
        serializer.serialize_str(&msg)
    }
}
