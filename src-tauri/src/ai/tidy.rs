//! "AI Tidy Metadata" and "Get Abstract" — the two per-item cleanups
//! behind the toolbar's AI menu. Both are one-shot structured-output
//! requests against whichever provider is configured.

use super::{parse_json, send, Ask, AskSchema, Provider};
use crate::state::AppState;
use crate::{log, Error, Result};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::AppHandle;

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
    let provider = Provider::resolve(state).await?;
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
            "→ {}: find the abstract in {} chars of parsed text…",
            provider.model,
            page_text.len()
        ),
    );
    let mut ask = Ask::single(ABSTRACT_SYSTEM, prompt);
    ask.max_tokens = 4096;
    ask.schema = Some(AskSchema {
        name: "abstract",
        // Closed and fully required, so both providers can enforce it.
        strict: true,
        schema: json!({
            "type": "object",
            "additionalProperties": false,
            "properties": { "abstract": { "type": "string" } },
            "required": ["abstract"],
        }),
    });
    let reply = send(app, state, &provider, ask).await?;
    let parsed = parse_json(&reply.text)?;
    Ok(parsed["abstract"].as_str().unwrap_or("").trim().to_string())
}

pub async fn tidy_item(
    app: &AppHandle,
    state: &AppState,
    item: Value,
    page_image: Option<String>,
) -> Result<Value> {
    let provider = Provider::resolve(state).await?;
    let email = state.settings.read().await.contact_email.clone();
    let data = if item["data"].is_object() { item["data"].clone() } else { item.clone() };

    let context = crossref_context(app, state, &data, &email).await;
    let prompt = format!(
        "Current Zotero item metadata:\n{}{}",
        serde_json::to_string_pretty(&data)?,
        context
    );

    let with = if page_image.is_some() { " + first-page image" } else { "" };
    log(
        app,
        "info",
        format!(
            "→ {}: tidy request, {} chars prompt ({} chars CrossRef){with}…",
            provider.model,
            prompt.len(),
            context.len()
        ),
    );
    let mut ask = Ask::single(SYSTEM_PROMPT, prompt);
    ask.max_tokens = 8192;
    ask.image = page_image;
    ask.schema = Some(AskSchema {
        name: "zotero_fields",
        // Every property is optional here by design — returning only the
        // changed fields is the contract — so this can't be enforced.
        strict: false,
        schema: output_schema(),
    });
    let reply = send(app, state, &provider, ask).await?;
    parse_json(&reply.text)
}

/// A fresh CrossRef record for the item's DOI, trimmed of bulk, as a
/// prompt fragment. Empty when there's no DOI or the lookup fails —
/// grounding is an improvement, not a requirement.
async fn crossref_context(
    app: &AppHandle,
    state: &AppState,
    data: &Value,
    email: &str,
) -> String {
    let Some(doi) = data["DOI"].as_str().filter(|d| !d.is_empty()) else {
        log(app, "info", "Item has no DOI — tidying without CrossRef grounding");
        return String::new();
    };
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
        req = req.query(&[("mailto", email)]);
    }
    match req.send().await {
        Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
            Ok(body) => {
                let mut record = body["message"].clone();
                if let Some(obj) = record.as_object_mut() {
                    for k in CROSSREF_NOISE {
                        obj.remove(*k);
                    }
                }
                let context = format!(
                    "\n\nAuthoritative CrossRef record for DOI {doi}:\n{}",
                    serde_json::to_string_pretty(&record).unwrap_or_default()
                );
                log(
                    app,
                    "info",
                    format!("CrossRef grounding: {} chars after trimming", context.len()),
                );
                context
            }
            Err(_) => String::new(),
        },
        Ok(resp) => {
            log(
                app,
                "warn",
                format!(
                    "CrossRef lookup failed (HTTP {}) — continuing without it",
                    resp.status()
                ),
            );
            String::new()
        }
        Err(e) => {
            log(app, "warn", format!("CrossRef lookup failed ({e}) — continuing without it"));
            String::new()
        }
    }
}
