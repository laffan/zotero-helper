//! Files in Zotero storage: creating a child attachment item, sending
//! its bytes (first upload or replacement), and reading one item back.
//!
//! Zotero's upload is three requests — authorize, send to the storage
//! URL, register — and the authorization is where versioning lives: a
//! new file goes up with `If-None-Match: *`, a replacement with
//! `If-Match: <md5 of the file it replaces>`. A replacement whose md5 no
//! longer matches answers 412, which is how NOTES.md finds out that
//! someone else changed the file since we last saw it.

use super::{api_key, library_base, now_ms, write_token};
use crate::state::AppState;
use crate::{log, Error, Result};
use serde_json::{json, Value};
use tauri::AppHandle;

/// Create an `imported_file` attachment under `parent_key` (no file yet).
/// Returns the new attachment's key.
pub async fn create_attachment_item(
    state: &AppState,
    parent_key: &str,
    title: &str,
    filename: &str,
    content_type: &str,
) -> Result<String> {
    let base = library_base(state).await?;
    let mut item = json!({
        "itemType": "attachment",
        "linkMode": "imported_file",
        "parentItem": parent_key,
        "title": title,
        "filename": filename,
        "contentType": content_type,
        "tags": [],
        "relations": {},
    });
    if content_type.starts_with("text/") {
        item["charset"] = json!("utf-8");
    }
    let resp = state
        .http
        .post(format!("{base}/items"))
        .header("Zotero-API-Key", api_key(state).await)
        .header("Zotero-API-Version", "3")
        .header("Zotero-Write-Token", write_token())
        .json(&json!([item]))
        .send()
        .await?;
    let status = resp.status();
    let body: Value = resp.json().await?;
    if !status.is_success() {
        return Err(Error::msg(format!(
            "Creating attachment item failed (HTTP {status}): {body}"
        )));
    }
    let att = &body["successful"]["0"];
    att["key"]
        .as_str()
        .or_else(|| att["data"]["key"].as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| Error::msg(format!("Unexpected Zotero response: {body}")))
}

/// What became of an upload.
pub enum Upload {
    /// The file is in Zotero storage; carries its md5.
    Stored(String),
    /// `previous_md5` no longer describes the file in Zotero — it was
    /// replaced elsewhere since we last read it. Nothing was written.
    Conflict,
}

/// Send `bytes` as the file of attachment `att_key`. `previous_md5` is
/// None for an attachment that has never had a file, and the md5 of the
/// file being replaced otherwise.
pub async fn upload_file(
    app: &AppHandle,
    state: &AppState,
    att_key: &str,
    bytes: &[u8],
    filename: &str,
    previous_md5: Option<&str>,
) -> Result<Upload> {
    let base = library_base(state).await?;
    let key = api_key(state).await;
    let md5hex = format!("{:x}", md5::compute(bytes));
    let form = [
        ("md5", md5hex.clone()),
        ("filename", filename.to_string()),
        ("filesize", bytes.len().to_string()),
        ("mtime", now_ms().to_string()),
    ];
    let authorize = |req: reqwest::RequestBuilder| match previous_md5 {
        Some(prev) => req.header("If-Match", prev),
        None => req.header("If-None-Match", "*"),
    };
    let resp = authorize(
        state
            .http
            .post(format!("{base}/items/{att_key}/file"))
            .header("Zotero-API-Key", &key)
            .header("Zotero-API-Version", "3"),
    )
    .form(&form)
    .send()
    .await?;
    let status = resp.status();
    if status.as_u16() == 412 {
        return Ok(Upload::Conflict);
    }
    let auth: Value = resp.json().await?;
    if !status.is_success() {
        return Err(Error::msg(format!(
            "Upload authorization failed (HTTP {status}): {auth}"
        )));
    }
    if auth["exists"].as_i64() == Some(1) {
        log(app, "info", "File already exists in Zotero storage — skipping upload");
        return Ok(Upload::Stored(md5hex));
    }

    let url = auth["url"]
        .as_str()
        .ok_or_else(|| Error::msg(format!("No upload URL in authorization: {auth}")))?;
    let content_type = auth["contentType"].as_str().unwrap_or("application/octet-stream");
    let prefix = auth["prefix"].as_str().unwrap_or("");
    let suffix = auth["suffix"].as_str().unwrap_or("");
    let upload_key = auth["uploadKey"]
        .as_str()
        .ok_or_else(|| Error::msg("No uploadKey in authorization"))?;

    let mut body = Vec::with_capacity(prefix.len() + bytes.len() + suffix.len());
    body.extend_from_slice(prefix.as_bytes());
    body.extend_from_slice(bytes);
    body.extend_from_slice(suffix.as_bytes());
    log(
        app,
        "info",
        format!("Uploading {} KB to Zotero storage…", bytes.len().div_ceil(1024)),
    );
    let resp = state
        .http
        .post(url)
        .header("Content-Type", content_type)
        .body(body)
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(Error::msg(format!(
            "Storage upload failed (HTTP {})",
            resp.status()
        )));
    }

    // Registration carries the same precondition as the authorization.
    let resp = authorize(
        state
            .http
            .post(format!("{base}/items/{att_key}/file"))
            .header("Zotero-API-Key", &key)
            .header("Zotero-API-Version", "3"),
    )
    .form(&[("upload", upload_key)])
    .send()
    .await?;
    if resp.status().as_u16() == 412 {
        return Ok(Upload::Conflict);
    }
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(Error::msg(format!("Registering upload failed: {body}")));
    }
    Ok(Upload::Stored(md5hex))
}

/// One item, as the API returns it (`{ key, version, data, … }`), or
/// None when Zotero no longer has it.
pub async fn get_item(state: &AppState, key: &str) -> Result<Option<Value>> {
    let base = library_base(state).await?;
    let resp = state
        .http
        .get(format!("{base}/items/{key}"))
        .header("Zotero-API-Key", api_key(state).await)
        .header("Zotero-API-Version", "3")
        .send()
        .await?;
    if resp.status().as_u16() == 404 {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(Error::msg(format!(
            "Reading item {key} failed (HTTP {})",
            resp.status()
        )));
    }
    Ok(Some(resp.json().await?))
}
