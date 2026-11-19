//! Each provider's own list of the models it offers now — what Settings →
//! AI lists to choose from, beside the app's catalog of models it knows
//! the prices of (src/lib/ai/models.ts), so a model released since that
//! catalog was written can be picked the day it appears.
//!
//! Anthropic lists its models newest first, with names to show
//! (`GET /v1/models`). OpenAI lists everything its key can reach —
//! embeddings, speech, images, moderation besides the chat models — with
//! ids only; what this app can't use through Chat Completions is left
//! out by its id.

use super::Service;
use crate::state::AppState;
use crate::{Error, Result};
use serde_json::Value;
use std::time::Duration;

const ANTHROPIC_MODELS: &str = "https://api.anthropic.com/v1/models?limit=1000";
const OPENAI_MODELS: &str = "https://api.openai.com/v1/models";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const TIMEOUT: Duration = Duration::from_secs(30);

/// OpenAI ids with any of these in them aren't text chat models (or need
/// another API than the one this app speaks).
const OPENAI_LEFT_OUT: &[&str] = &[
    "audio", "realtime", "transcribe", "tts", "image", "search", "embedding", "instruct",
    "moderation", "codex", "computer-use", "deep-research", "-pro", "whisper", "dall-e",
];

/// A model as its provider lists it.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListedModel {
    pub id: String,
    /// The provider's name for it (Anthropic's); the id where it has none.
    pub label: String,
    /// When it was released (Anthropic) or made available (OpenAI),
    /// "YYYY-MM-DD"; empty when unknown.
    pub released: String,
}

/// The models `service` lists for `api_key` — the one being typed into
/// Settings, or else the one saved — newest first.
pub async fn list_models(state: &AppState, service: &str, api_key: Option<String>) -> Result<Vec<ListedModel>> {
    let service = Service::parse(service);
    let key = match api_key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
        Some(k) => k,
        None => {
            let s = state.settings.read().await;
            match service {
                Service::Anthropic => s.anthropic_api_key.trim().to_string(),
                Service::OpenAi => s.openai_api_key.trim().to_string(),
            }
        }
    };
    if key.is_empty() {
        return Err(Error::msg(format!("No {} API key to list its models with", service.label())));
    }
    let req = match service {
        Service::Anthropic => state
            .http
            .get(ANTHROPIC_MODELS)
            .header("x-api-key", &key)
            .header("anthropic-version", ANTHROPIC_VERSION),
        Service::OpenAi => state.http.get(OPENAI_MODELS).header("authorization", format!("Bearer {key}")),
    };
    let resp = req
        .timeout(TIMEOUT)
        .send()
        .await
        .map_err(|e| Error::msg(format!("Could not reach {}: {e}", service.label())))?;
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let why = body["error"]["message"].as_str().unwrap_or("no reason given");
        return Err(Error::msg(format!("{} refused the model list ({status}): {why}", service.label())));
    }
    let data = body["data"].as_array().cloned().unwrap_or_default();
    let mut list: Vec<ListedModel> = match service {
        Service::Anthropic => data
            .iter()
            .filter_map(|m| {
                let id = m["id"].as_str()?.to_string();
                Some(ListedModel {
                    label: m["display_name"].as_str().unwrap_or(&id).to_string(),
                    released: m["created_at"].as_str().unwrap_or("").chars().take(10).collect(),
                    id,
                })
            })
            .collect(),
        Service::OpenAi => data
            .iter()
            .filter_map(|m| {
                let id = m["id"].as_str()?.to_string();
                let chat = id.starts_with("gpt-") || id.starts_with("chatgpt-") || is_o_series(&id);
                if !chat || OPENAI_LEFT_OUT.iter().any(|w| id.contains(w)) {
                    return None;
                }
                Some(ListedModel {
                    label: id.clone(),
                    released: m["created"].as_i64().map(date_of).unwrap_or_default(),
                    id,
                })
            })
            .collect(),
    };
    // Newest first (Anthropic sends them so; OpenAI in no order).
    list.sort_by(|a, b| b.released.cmp(&a.released).then_with(|| a.id.cmp(&b.id)));
    Ok(list)
}

/// "o1", "o3-mini", "o4-mini-2025-04-16"…
fn is_o_series(id: &str) -> bool {
    let mut c = id.chars();
    c.next() == Some('o') && c.next().is_some_and(|d| d.is_ascii_digit())
}

/// A Unix time in seconds as "YYYY-MM-DD" (UTC), by Howard Hinnant's
/// civil-from-days.
fn date_of(secs: i64) -> String {
    let z = secs.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates() {
        assert_eq!(date_of(0), "1970-01-01");
        assert_eq!(date_of(1_700_000_000), "2023-11-14");
    }

    #[test]
    fn o_series() {
        assert!(is_o_series("o3-mini"));
        assert!(!is_o_series("omni-moderation-latest"));
    }
}
