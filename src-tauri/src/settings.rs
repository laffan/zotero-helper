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
    /// Which model provider every AI feature talks to: "anthropic" or "openai".
    pub ai_service: String,
    pub anthropic_api_key: String,
    pub anthropic_model: String,
    pub openai_api_key: String,
    pub openai_model: String,
    /// Minimum delay between automated requests to the same host, in ms.
    pub rate_limit_ms: u64,
}

/// Defaults for the two dropdowns. The frontend owns the full catalog
/// (src/lib/ai/models.ts) — these only have to be valid ids.
pub const DEFAULT_ANTHROPIC_MODEL: &str = "claude-sonnet-5";
pub const DEFAULT_OPENAI_MODEL: &str = "gpt-5.6-terra";

impl Default for Settings {
    fn default() -> Self {
        Settings {
            zotero_api_key: String::new(),
            zotero_user_id: String::new(),
            library_type: "user".into(),
            contact_email: String::new(),
            ai_service: "anthropic".into(),
            anthropic_api_key: String::new(),
            anthropic_model: DEFAULT_ANTHROPIC_MODEL.into(),
            openai_api_key: String::new(),
            openai_model: DEFAULT_OPENAI_MODEL.into(),
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
