//! Resolve identifiers (DOI / ISBN / arXiv / URL) to Zotero item data.
//! One submodule per metadata source; shared parsing helpers live here.

mod arxiv;
mod doi;
mod isbn;
mod url;

use crate::state::AppState;
use crate::{Error, Result};
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

#[derive(Debug, Clone, PartialEq)]
pub enum Identifier {
    Doi(String),
    Isbn(String),
    Arxiv(String),
    Url(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolved {
    /// Zotero item `data` object, ready to POST.
    pub item: Value,
    /// Candidate PDF URLs discovered during resolution (ordered by quality).
    pub pdf_candidates: Vec<String>,
    /// Landing-page URL for the manual-rescue browser.
    pub landing_url: Option<String>,
    pub kind: String,
}

pub fn classify(raw: &str) -> Option<Identifier> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    // DOI URLs and bare DOIs
    let lower = s.to_ascii_lowercase();
    for prefix in [
        "https://doi.org/",
        "http://doi.org/",
        "https://dx.doi.org/",
        "http://dx.doi.org/",
        "doi:",
    ] {
        if lower.starts_with(prefix) {
            return Some(Identifier::Doi(s[prefix.len()..].trim().to_string()));
        }
    }
    let doi_re = Regex::new(r"^10\.\d{4,9}/\S+$").unwrap();
    if doi_re.is_match(s) {
        return Some(Identifier::Doi(s.to_string()));
    }
    // arXiv
    let arxiv_re = Regex::new(r"^(?i)(arxiv:)?(\d{4}\.\d{4,5})(v\d+)?$").unwrap();
    if let Some(c) = arxiv_re.captures(s) {
        return Some(Identifier::Arxiv(c[2].to_string()));
    }
    if let Some(rest) = lower
        .strip_prefix("https://arxiv.org/abs/")
        .or_else(|| lower.strip_prefix("http://arxiv.org/abs/"))
    {
        return Some(Identifier::Arxiv(rest.trim_end_matches('/').to_string()));
    }
    // ISBN (10 or 13 digits, hyphens/spaces allowed)
    let compact: String = s.chars().filter(|c| !matches!(c, '-' | ' ')).collect();
    let isbn10 = Regex::new(r"^\d{9}[\dXx]$").unwrap();
    let isbn13 = Regex::new(r"^97[89]\d{10}$").unwrap();
    let lower_compact = compact
        .to_ascii_lowercase()
        .trim_start_matches("isbn:")
        .to_string();
    if isbn10.is_match(&lower_compact) || isbn13.is_match(&lower_compact) {
        return Some(Identifier::Isbn(lower_compact.to_uppercase()));
    }
    // URL
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return Some(Identifier::Url(s.to_string()));
    }
    None
}

/// Find a DOI for an existing entry (CrossRef bibliographic search with
/// strict title/year matching). See doi.rs.
pub async fn discover_doi(
    app: &AppHandle,
    state: &AppState,
    title: &str,
    author: Option<&str>,
    year: Option<i64>,
) -> Result<Option<String>> {
    doi::discover_doi(app, state, title, author, year).await
}

pub async fn resolve(app: &AppHandle, state: &AppState, raw: &str) -> Result<Resolved> {
    let id = classify(raw).ok_or_else(|| {
        Error::msg(format!(
            "Unrecognized identifier: “{raw}” (expected DOI, ISBN, arXiv ID, or URL)"
        ))
    })?;
    match id {
        Identifier::Doi(d) => doi::resolve_doi(app, state, &d).await,
        Identifier::Isbn(i) => isbn::resolve_isbn(app, state, &i).await,
        Identifier::Arxiv(a) => arxiv::resolve_arxiv(app, state, &a).await,
        Identifier::Url(u) => url::resolve_url(app, state, &u).await,
    }
}

// ------------------------------------------------------------------ helpers
// Shared by the per-source resolvers below (and `meta_values` by pdf.rs).

pub(super) fn strip_tags(s: &str) -> String {
    let re = Regex::new(r"<[^>]+>").unwrap();
    let text = re.replace_all(s, " ");
    let decoded = html_escape::decode_html_entities(&text);
    Regex::new(r"\s+")
        .unwrap()
        .replace_all(decoded.trim(), " ")
        .to_string()
}

pub(super) fn set_if(obj: &mut Value, key: &str, val: Option<String>) {
    if let Some(v) = val {
        if !v.is_empty() {
            obj[key] = Value::String(v);
        }
    }
}

pub(super) fn s_of(v: &Value) -> Option<String> {
    v.as_str().map(|s| s.to_string())
}

pub(super) fn first_str(v: &Value) -> Option<String> {
    v.as_array()
        .and_then(|a| a.first())
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
}

pub(super) fn split_name(full: &str) -> Value {
    let full = full.trim();
    match full.rsplit_once(' ') {
        Some((first, last)) => json!({
            "creatorType": "author",
            "firstName": first,
            "lastName": last,
        }),
        None => json!({ "creatorType": "author", "name": full }),
    }
}

/// Extract `<meta name="..." content="...">` values, tolerating either
/// attribute order. Also used by the PDF-discovery module.
pub fn meta_values(html: &str, name: &str) -> Vec<String> {
    let mut out = Vec::new();
    let p1 = format!(
        r#"(?i)<meta[^>]*name\s*=\s*["']{}["'][^>]*content\s*=\s*["']([^"']*)["']"#,
        regex::escape(name)
    );
    let p2 = format!(
        r#"(?i)<meta[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']{}["']"#,
        regex::escape(name)
    );
    for pat in [p1, p2] {
        if let Ok(re) = Regex::new(&pat) {
            for c in re.captures_iter(html) {
                let v = html_escape::decode_html_entities(&c[1]).trim().to_string();
                if !v.is_empty() && !out.contains(&v) {
                    out.push(v);
                }
            }
        }
    }
    out
}

pub(super) fn meta_first(html: &str, name: &str) -> Option<String> {
    meta_values(html, name).into_iter().next()
}
