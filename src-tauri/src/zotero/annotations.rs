//! Writes of single annotation items — what the reader's highlights and
//! underlines turn into. Zotero keeps annotations as ordinary items
//! (itemType "annotation", parentItem = the PDF attachment), so these
//! are plain item writes; what this module adds over `create_items` /
//! `update_item` is the answer each caller needs to keep going: the
//! created item, the new version, or "it's gone".

use super::{api_key, header_u64, library_base, write_token};
use crate::state::AppState;
use crate::{Error, Result};
use serde_json::Value;

/// What a create came to.
pub enum Created {
    /// Zotero has it; the item as the API returns it.
    Item(Value),
    /// Zotero refused the item itself — retrying won't change that.
    Rejected(String),
}

/// What an update or a delete came to.
pub enum Written {
    /// Done; the library's version after the write.
    Version(u64),
    /// The item changed in Zotero since `version`.
    Conflict,
    /// Zotero has no such item (deleted elsewhere).
    Gone,
}

/// Create one annotation. `data` carries its own `key`, so a retry
/// after a lost response finds the item already there and adopts it.
pub async fn create(state: &AppState, data: &Value) -> Result<Created> {
    let base = library_base(state).await?;
    let resp = state
        .http
        .post(format!("{base}/items"))
        .header("Zotero-API-Key", api_key(state).await)
        .header("Zotero-API-Version", "3")
        .header("Zotero-Write-Token", write_token())
        .json(&[data])
        .send()
        .await?;
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(Error::msg(format!("Zotero write failed (HTTP {status}): {body}")));
    }
    if let Some(item) = body.pointer("/successful/0") {
        return Ok(Created::Item(item.clone()));
    }
    let failed = body.pointer("/failed/0").cloned().unwrap_or(Value::Null);
    let key = data.get("key").and_then(Value::as_str).unwrap_or_default();
    if !key.is_empty() {
        if let Some(item) = super::files::get_item(state, key).await? {
            return Ok(Created::Item(item));
        }
    }
    let code = failed.get("code").and_then(Value::as_u64).unwrap_or(0);
    let message = failed
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("no reason given")
        .to_string();
    if (400..500).contains(&code) && code != 429 {
        return Ok(Created::Rejected(message));
    }
    Err(Error::msg(format!("Zotero did not save the annotation ({code}): {message}")))
}

fn written(resp: &reqwest::Response) -> Option<Written> {
    match resp.status().as_u16() {
        404 => Some(Written::Gone),
        412 => Some(Written::Conflict),
        s if (200..300).contains(&s) => Some(Written::Version(header_u64(resp, "Last-Modified-Version"))),
        _ => None,
    }
}

/// PATCH an annotation's fields, failing as `Conflict` if it changed
/// in Zotero since `version`.
pub async fn patch(state: &AppState, key: &str, version: u64, patch: &Value) -> Result<Written> {
    let base = library_base(state).await?;
    let resp = state
        .http
        .patch(format!("{base}/items/{key}"))
        .header("Zotero-API-Key", api_key(state).await)
        .header("Zotero-API-Version", "3")
        .header("If-Unmodified-Since-Version", version.to_string())
        .json(patch)
        .send()
        .await?;
    if let Some(w) = written(&resp) {
        return Ok(w);
    }
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    Err(Error::msg(format!("Updating annotation {key} failed (HTTP {status}): {body}")))
}

/// Delete one annotation, failing as `Conflict` if it changed in
/// Zotero since `version`.
pub async fn delete(state: &AppState, key: &str, version: u64) -> Result<Written> {
    let base = library_base(state).await?;
    let resp = state
        .http
        .delete(format!("{base}/items/{key}"))
        .header("Zotero-API-Key", api_key(state).await)
        .header("Zotero-API-Version", "3")
        .header("If-Unmodified-Since-Version", version.to_string())
        .send()
        .await?;
    if let Some(w) = written(&resp) {
        return Ok(w);
    }
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    Err(Error::msg(format!("Deleting annotation {key} failed (HTTP {status}): {body}")))
}

/// The item's current version in Zotero, or None when it's gone.
pub async fn current_version(state: &AppState, key: &str) -> Result<Option<u64>> {
    Ok(super::files::get_item(state, key)
        .await?
        .and_then(|item| item.get("version").and_then(Value::as_u64)))
}
