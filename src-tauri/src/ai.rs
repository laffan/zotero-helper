//! "AI Tidy Metadata": ask Claude to correct/complete an item's bibliographic
//! fields, grounded in a fresh CrossRef record when a DOI is available.
//! Returns a partial field map that the caller merges into the item.

use crate::state::AppState;
use crate::{log, Error, Result};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tauri::AppHandle;

const ANTHROPIC_API: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

fn output_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "title": { "type": "string" },
            "creators": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "creatorType": { "type": "string" },
                        "firstName": { "type": "string" },
                        "lastName": { "type": "string" },
                        "name": { "type": "string" }
                    },
                    "required": ["creatorType"]
                }
            },
            "abstractNote": { "type": "string" },
            "date": { "type": "string" },
            "publicationTitle": { "type": "string" },
            "journalAbbreviation": { "type": "string" },
            "volume": { "type": "string" },
            "issue": { "type": "string" },
            "pages": { "type": "string" },
            "DOI": { "type": "string" },
            "ISSN": { "type": "string" },
            "ISBN": { "type": "string" },
            "publisher": { "type": "string" },
            "place": { "type": "string" },
            "url": { "type": "string" },
            "language": { "type": "string" },
            "shortTitle": { "type": "string" },
            "extra": { "type": "string" }
        },
        "required": []
    })
}

const SYSTEM_PROMPT: &str = "You are a bibliographic metadata specialist working inside a Zotero \
companion app used at a university. You receive a Zotero item's current metadata, plus (when \
available) an authoritative CrossRef record for its DOI. Return corrections and additions as a \
JSON object containing ONLY the fields that should change. Omit every field that is already \
correct. Rules: prefer the authoritative record over the existing data when they conflict; fix \
casing (use sentence case for titles per common citation-style practice, preserving proper nouns \
and acronyms); normalize author names into firstName/lastName; expand missing fields (abstract, \
volume, issue, pages, ISSN, DOI, language) when the authoritative record has them; never invent \
data that is not supported by the provided sources; dates use ISO-like formats (YYYY, YYYY-MM, or \
YYYY-MM-DD). If everything is already correct, return an empty object.";

pub async fn tidy_item(app: &AppHandle, state: &AppState, item: Value) -> Result<Value> {
    let (api_key, model, email) = {
        let s = state.settings.read().await;
        (
            s.anthropic_api_key.clone(),
            s.anthropic_model.clone(),
            s.contact_email.clone(),
        )
    };
    if api_key.is_empty() {
        return Err(Error::msg(
            "No Anthropic API key configured — add one in Settings to use AI Tidy",
        ));
    }

    let data = if item["data"].is_object() { item["data"].clone() } else { item.clone() };

    // Ground the model with a fresh authoritative record when possible.
    let mut context = String::new();
    if let Some(doi) = data["DOI"].as_str().filter(|d| !d.is_empty()) {
        state.throttle("api.crossref.org").await;
        let mut req = state
            .http
            .get(format!(
                "https://api.crossref.org/works/{}",
                utf8_percent_encode(doi, NON_ALPHANUMERIC)
            ));
        if !email.is_empty() {
            req = req.query(&[("mailto", email.as_str())]);
        }
        if let Ok(resp) = req.send().await {
            if resp.status().is_success() {
                if let Ok(body) = resp.json::<Value>().await {
                    context = format!(
                        "\n\nAuthoritative CrossRef record for DOI {doi}:\n{}",
                        serde_json::to_string_pretty(&body["message"]).unwrap_or_default()
                    );
                }
            }
        }
    }

    let prompt = format!(
        "Current Zotero item metadata:\n{}{}",
        serde_json::to_string_pretty(&data)?,
        context
    );

    log(app, "info", format!("Asking {model} to tidy metadata…"));
    let body = json!({
        "model": model,
        "max_tokens": 8192,
        "system": SYSTEM_PROMPT,
        "output_config": { "format": { "type": "json_schema", "schema": output_schema() } },
        "messages": [{ "role": "user", "content": prompt }],
    });

    let resp = state
        .http
        .post(ANTHROPIC_API)
        .header("x-api-key", &api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await?;
    let status = resp.status();
    let out: Value = resp.json().await?;
    if !status.is_success() {
        let msg = out["error"]["message"].as_str().unwrap_or("unknown error");
        return Err(Error::msg(format!("Anthropic API error (HTTP {status}): {msg}")));
    }
    if out["stop_reason"].as_str() == Some("refusal") {
        return Err(Error::msg("The model declined this request"));
    }
    let text = out["content"]
        .as_array()
        .and_then(|blocks| {
            blocks
                .iter()
                .find(|b| b["type"].as_str() == Some("text"))
                .and_then(|b| b["text"].as_str())
        })
        .ok_or_else(|| Error::msg("Empty response from the model"))?;
    let fixes: Value = serde_json::from_str(text.trim())
        .map_err(|e| Error::msg(format!("Model returned invalid JSON: {e}")))?;
    Ok(fixes)
}
