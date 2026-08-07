//! "AI Tidy Metadata": ask Claude to correct/complete an item's bibliographic
//! fields, grounded in a fresh CrossRef record when a DOI is available.
//! Returns a partial field map that the caller merges into the item.

use crate::state::AppState;
use crate::{log, Error, Result};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::AppHandle;

const ANTHROPIC_API: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODELS_API: &str = "https://api.anthropic.com/v1/models";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const MODEL_TIMEOUT: Duration = Duration::from_secs(90);

/// POST to the Messages API with a per-request timeout, one retry on
/// transport failures (fresh connection), and timing logs — so a stall
/// is visible in the terminal instead of looking like a silent hang.
/// Returns the response's text content.
async fn call_model(
    app: &AppHandle,
    state: &AppState,
    api_key: &str,
    body: &Value,
) -> Result<String> {
    let model = body["model"].as_str().unwrap_or("?").to_string();
    let started = Instant::now();
    let mut attempt = 0;
    let resp = loop {
        attempt += 1;
        let sent = Instant::now();
        let r = state
            .http
            .post(ANTHROPIC_API)
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .timeout(MODEL_TIMEOUT)
            .json(body)
            .send()
            .await;
        match r {
            Ok(resp) => break resp,
            Err(e) if attempt == 1 => log(
                app,
                "warn",
                format!(
                    "Model request failed after {:.0}s ({e}) — retrying once…",
                    sent.elapsed().as_secs_f32()
                ),
            ),
            Err(e) => return Err(e.into()),
        }
    };
    let status = resp.status();
    let out: Value = resp.json().await?;
    if !status.is_success() {
        let msg = out["error"]["message"].as_str().unwrap_or("unknown error");
        return Err(Error::msg(format!("Anthropic API error (HTTP {status}): {msg}")));
    }
    if out["stop_reason"].as_str() == Some("refusal") {
        return Err(Error::msg("The model declined this request"));
    }
    log(
        app,
        "info",
        format!(
            "← {model} replied in {:.1}s ({} tokens in, {} out, stop: {})",
            started.elapsed().as_secs_f32(),
            out["usage"]["input_tokens"].as_u64().unwrap_or(0),
            out["usage"]["output_tokens"].as_u64().unwrap_or(0),
            out["stop_reason"].as_str().unwrap_or("?"),
        ),
    );
    out["content"]
        .as_array()
        .and_then(|blocks| {
            blocks
                .iter()
                .find(|b| b["type"].as_str() == Some("text"))
                .and_then(|b| b["text"].as_str())
        })
        .map(String::from)
        .ok_or_else(|| Error::msg("Empty response from the model"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub display_name: String,
}

/// List the models available to the given API key via GET /v1/models,
/// following `after_id` pagination. The endpoint returns newest-first.
pub async fn list_models(state: &AppState, api_key: &str) -> Result<Vec<ModelInfo>> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err(Error::msg("No Anthropic API key provided"));
    }
    let mut models = Vec::new();
    let mut after_id: Option<String> = None;
    loop {
        let mut req = state
            .http
            .get(ANTHROPIC_MODELS_API)
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .query(&[("limit", "100")]);
        if let Some(after) = &after_id {
            req = req.query(&[("after_id", after.as_str())]);
        }
        let resp = req.send().await?;
        let status = resp.status();
        let body: Value = resp.json().await?;
        if !status.is_success() {
            let msg = body["error"]["message"].as_str().unwrap_or("unknown error");
            return Err(Error::msg(format!("Anthropic API error (HTTP {status}): {msg}")));
        }
        for m in body["data"].as_array().into_iter().flatten() {
            if let Some(id) = m["id"].as_str() {
                models.push(ModelInfo {
                    id: id.to_string(),
                    display_name: m["display_name"].as_str().unwrap_or(id).to_string(),
                });
            }
        }
        if body["has_more"].as_bool() == Some(true) {
            after_id = body["last_id"].as_str().map(String::from);
            if after_id.is_none() {
                break;
            }
        } else {
            break;
        }
    }
    Ok(models)
}

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
companion app used at a university. You receive a Zotero item's current metadata, sometimes a \
rendered image of the first page of the item's PDF, and (when a DOI is known) an authoritative \
CrossRef record. Return corrections and additions as a JSON object containing ONLY the fields \
that should change. Omit every field that is already correct. Rules: the first-page image is the \
primary source for the title, creators, and abstract as actually published — read it carefully, \
including small text; the CrossRef record is authoritative for identifiers and publication \
details (DOI, ISSN, volume, issue, pages, dates); prefer these sources over the existing data \
when they conflict; fix casing (use sentence case for titles per common citation-style practice, \
preserving proper nouns and acronyms); normalize author names into firstName/lastName; expand \
missing fields (abstract, volume, issue, pages, ISSN, DOI, language) when the sources have them; \
never invent data that is not supported by the provided sources; dates use ISO-like formats \
(YYYY, YYYY-MM, or YYYY-MM-DD). If everything is already correct, return an empty object.";

/// Fields of a CrossRef record that add bulk without helping metadata
/// extraction — the reference list alone can be tens of thousands of
/// tokens on well-cited papers (and was why v1 took minutes per item).
const CROSSREF_NOISE: &[&str] = &[
    "reference", "relation", "license", "link", "indexed", "assertion",
    "content-domain", "is-referenced-by-count", "references-count", "score",
];

const ABSTRACT_SYSTEM: &str = "You extract the abstract of a scholarly work from parsed text of \
its first pages (extracted with a PDF parser, so reading order is generally correct but headers, \
footers, and artifacts may be interleaved). Return JSON {\"abstract\": \"...\"}. Rules: return the \
publication's own abstract (or summary) verbatim — fix only obvious extraction artifacts like \
hyphenation across line breaks, stray header/footer fragments, and hard line wraps; do not \
paraphrase, translate, or shorten. The provided item metadata tells you which work this is — if \
the text clearly belongs to a different work, or contains no abstract, return an empty string.";

/// Extract the item's abstract from LiteParse-extracted first-page text.
/// Returns "" when no abstract is present.
pub async fn get_abstract(
    app: &AppHandle,
    state: &AppState,
    item: Value,
    page_text: String,
) -> Result<String> {
    let (api_key, model) = {
        let s = state.settings.read().await;
        (s.anthropic_api_key.clone(), s.anthropic_model.clone())
    };
    if api_key.is_empty() {
        return Err(Error::msg(
            "No Anthropic API key configured — add one in Settings first",
        ));
    }
    if page_text.trim().is_empty() {
        return Err(Error::msg("No text could be extracted from the PDF"));
    }

    let data = if item["data"].is_object() { item["data"].clone() } else { item.clone() };
    let brief = json!({
        "title": data["title"],
        "creators": data["creators"],
        "date": data["date"],
        "DOI": data["DOI"],
    });
    let prompt = format!(
        "Item this text should belong to:\n{brief}\n\nParsed text of the first pages:\n\n{page_text}",
    );

    log(
        app,
        "info",
        format!(
            "→ {model}: find the abstract in {} chars of parsed text (waiting, up to 90s/try)…",
            page_text.len()
        ),
    );
    let body = json!({
        "model": model,
        "max_tokens": 4096,
        "system": ABSTRACT_SYSTEM,
        "output_config": { "format": { "type": "json_schema", "schema": {
            "type": "object",
            "additionalProperties": false,
            "properties": { "abstract": { "type": "string" } },
            "required": ["abstract"],
        } } },
        "messages": [{ "role": "user", "content": prompt }],
    });
    let text = call_model(app, state, &api_key, &body).await?;
    let parsed: Value = serde_json::from_str(text.trim())
        .map_err(|e| Error::msg(format!("Model returned invalid JSON: {e}")))?;
    Ok(parsed["abstract"].as_str().unwrap_or("").trim().to_string())
}

pub async fn tidy_item(
    app: &AppHandle,
    state: &AppState,
    item: Value,
    page_image: Option<String>,
) -> Result<Value> {
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
        log(app, "info", format!("Fetching CrossRef record for {doi}…"));
        state.throttle("api.crossref.org").await;
        let mut req = state
            .http
            .get(format!(
                "https://api.crossref.org/works/{}",
                utf8_percent_encode(doi, NON_ALPHANUMERIC)
            ))
            .timeout(Duration::from_secs(30));
        if !email.is_empty() {
            req = req.query(&[("mailto", email.as_str())]);
        }
        match req.send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(body) = resp.json::<Value>().await {
                    let mut record = body["message"].clone();
                    if let Some(obj) = record.as_object_mut() {
                        for k in CROSSREF_NOISE {
                            obj.remove(*k);
                        }
                    }
                    context = format!(
                        "\n\nAuthoritative CrossRef record for DOI {doi}:\n{}",
                        serde_json::to_string_pretty(&record).unwrap_or_default()
                    );
                    log(
                        app,
                        "info",
                        format!("CrossRef grounding: {} chars after trimming", context.len()),
                    );
                }
            }
            Ok(resp) => log(
                app,
                "warn",
                format!("CrossRef lookup failed (HTTP {}) — continuing without it", resp.status()),
            ),
            Err(e) => log(
                app,
                "warn",
                format!("CrossRef lookup failed ({e}) — continuing without it"),
            ),
        }
    } else {
        log(app, "info", "Item has no DOI — tidying without CrossRef grounding");
    }

    let prompt = format!(
        "Current Zotero item metadata:\n{}{}",
        serde_json::to_string_pretty(&data)?,
        context
    );

    let mut content = Vec::new();
    if let Some(img) = &page_image {
        content.push(json!({
            "type": "image",
            "source": { "type": "base64", "media_type": "image/jpeg", "data": img },
        }));
    }
    content.push(json!({ "type": "text", "text": prompt }));

    let with = if page_image.is_some() { " + first-page image" } else { "" };
    log(
        app,
        "info",
        format!(
            "→ {model}: tidy request, {} chars prompt ({} chars CrossRef){with} (waiting, up to 90s/try)…",
            prompt.len(),
            context.len()
        ),
    );
    let body = json!({
        "model": model,
        "max_tokens": 8192,
        "system": SYSTEM_PROMPT,
        "output_config": { "format": { "type": "json_schema", "schema": output_schema() } },
        "messages": [{ "role": "user", "content": content }],
    });

    let text = call_model(app, state, &api_key, &body).await?;
    let fixes: Value = serde_json::from_str(text.trim())
        .map_err(|e| Error::msg(format!("Model returned invalid JSON: {e}")))?;
    Ok(fixes)
}
