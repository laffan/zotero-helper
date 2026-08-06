use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub zotero_api_key: String,
    /// Numeric user ID (or group ID when library_type == "group").
    pub zotero_user_id: String,
    /// "user" or "group"
    pub library_type: String,
    /// Email sent to Unpaywall / CrossRef polite pools. Optional but recommended.
    pub contact_email: String,
    pub anthropic_api_key: String,
    pub anthropic_model: String,
    /// Minimum delay between automated requests to the same host, in ms.
    pub rate_limit_ms: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            zotero_api_key: String::new(),
            zotero_user_id: String::new(),
            library_type: "user".into(),
            contact_email: String::new(),
            anthropic_api_key: String::new(),
            anthropic_model: "claude-opus-5".into(),
            rate_limit_ms: 1500,
        }
    }
}

pub fn settings_path(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join("settings.json")
}

pub fn load(data_dir: &Path) -> Settings {
    let path = settings_path(data_dir);
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save(data_dir: &Path, settings: &Settings) -> crate::Result<()> {
    let path = settings_path(data_dir);
    std::fs::write(&path, serde_json::to_string_pretty(settings)?)?;
    Ok(())
}
