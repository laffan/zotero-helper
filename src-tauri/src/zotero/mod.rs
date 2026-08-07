//! Zotero Web API v3 client: credentials, item/collection writes, and
//! the three-step file upload flow for attachments. The sync engine
//! (paginated fetches, retries, resumable initial download) lives in
//! the `sync` submodule.

mod sync;

pub use sync::{sync_collection, sync_library};

use crate::state::AppState;
use crate::{log, Error, Result};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use tauri::AppHandle;

const API: &str = "https://api.zotero.org";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct LibraryCache {
    pub version: u64,
    pub collections: Vec<Value>,
    pub items: Vec<Value>,
    pub last_sync_ms: u64,
}

fn cache_path(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join("library.json")
}

pub fn load_cache(data_dir: &Path) -> LibraryCache {
    match std::fs::read_to_string(cache_path(data_dir)) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => LibraryCache::default(),
    }
}

pub fn save_cache(data_dir: &Path, cache: &LibraryCache) -> Result<()> {
    std::fs::write(cache_path(data_dir), serde_json::to_string(cache)?)?;
    Ok(())
}

pub(super) async fn library_base(state: &AppState) -> Result<String> {
    let s = state.settings.read().await;
    if s.zotero_api_key.is_empty() || s.zotero_user_id.is_empty() {
        return Err(Error::msg(
            "Zotero credentials are not configured — open Settings first",
        ));
    }
    let kind = if s.library_type == "group" { "groups" } else { "users" };
    Ok(format!("{API}/{kind}/{}", s.zotero_user_id))
}

pub(super) async fn api_key(state: &AppState) -> String {
    state.settings.read().await.zotero_api_key.clone()
}

fn write_token() -> String {
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| {
            let n: u8 = rng.gen_range(0..16);
            char::from_digit(n as u32, 16).unwrap()
        })
        .collect()
}

pub(super) fn header_u64(resp: &reqwest::Response, name: &str) -> u64 {
    resp.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

/// Verify an API key against /keys/current; returns { userID, username, access }.
pub async fn verify_key(state: &AppState, key: &str) -> Result<Value> {
    let resp = state
        .http
        .get(format!("{API}/keys/current"))
        .header("Zotero-API-Key", key)
        .header("Zotero-API-Version", "3")
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(Error::msg(format!(
            "Zotero rejected the API key (HTTP {})",
            resp.status()
        )));
    }
    Ok(resp.json().await?)
}

/// Download an attachment's file content (Zotero redirects to its
/// storage backend; reqwest follows). Returns the raw bytes.
pub async fn download_attachment(state: &AppState, key: &str) -> Result<Vec<u8>> {
    let base = library_base(state).await?;
    let resp = state
        .http
        .get(format!("{base}/items/{key}/file"))
        .header("Zotero-API-Key", api_key(state).await)
        .header("Zotero-API-Version", "3")
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(Error::msg(format!(
            "Zotero file download failed (HTTP {})",
            resp.status()
        )));
    }
    Ok(resp.bytes().await?.to_vec())
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// POST an array of new items. Returns Zotero's response JSON
/// ({ successful, unchanged, failed }).
pub async fn create_items(state: &AppState, items: Vec<Value>) -> Result<Value> {
    let base = library_base(state).await?;
    let key = api_key(state).await;
    let resp = state
        .http
        .post(format!("{base}/items"))
        .header("Zotero-API-Key", &key)
        .header("Zotero-API-Version", "3")
        .header("Zotero-Write-Token", write_token())
        .json(&items)
        .send()
        .await?;
    let status = resp.status();
    let body: Value = resp.json().await?;
    if !status.is_success() {
        return Err(Error::msg(format!("Zotero write failed (HTTP {status}): {body}")));
    }
    Ok(body)
}

/// PATCH an existing item's data fields.
pub async fn update_item(state: &AppState, key_id: &str, version: u64, patch: Value) -> Result<()> {
    let base = library_base(state).await?;
    let key = api_key(state).await;
    let resp = state
        .http
        .patch(format!("{base}/items/{key_id}"))
        .header("Zotero-API-Key", &key)
        .header("Zotero-API-Version", "3")
        .header("If-Unmodified-Since-Version", version.to_string())
        .json(&patch)
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(Error::msg(format!("Zotero update failed (HTTP {status}): {body}")));
    }
    Ok(())
}

pub async fn create_collection(
    state: &AppState,
    name: &str,
    parent: Option<String>,
) -> Result<Value> {
    let base = library_base(state).await?;
    let key = api_key(state).await;
    let payload = json!([{
        "name": name,
        "parentCollection": parent.map(Value::from).unwrap_or(Value::Bool(false)),
    }]);
    let resp = state
        .http
        .post(format!("{base}/collections"))
        .header("Zotero-API-Key", &key)
        .header("Zotero-API-Version", "3")
        .header("Zotero-Write-Token", write_token())
        .json(&payload)
        .send()
        .await?;
    let status = resp.status();
    let body: Value = resp.json().await?;
    if !status.is_success() {
        return Err(Error::msg(format!(
            "Creating collection failed (HTTP {status}): {body}"
        )));
    }
    Ok(body)
}

pub async fn delete_collection(state: &AppState, key_id: &str, version: u64) -> Result<()> {
    let base = library_base(state).await?;
    let key = api_key(state).await;
    let resp = state
        .http
        .delete(format!("{base}/collections/{key_id}"))
        .header("Zotero-API-Key", &key)
        .header("Zotero-API-Version", "3")
        .header("If-Unmodified-Since-Version", version.to_string())
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(Error::msg(format!(
            "Deleting collection failed (HTTP {status}): {body}"
        )));
    }
    Ok(())
}

pub async fn delete_items(state: &AppState, keys: Vec<String>, library_version: u64) -> Result<()> {
    let base = library_base(state).await?;
    let key = api_key(state).await;
    let resp = state
        .http
        .delete(format!("{base}/items"))
        .header("Zotero-API-Key", &key)
        .header("Zotero-API-Version", "3")
        .header("If-Unmodified-Since-Version", library_version.to_string())
        .query(&[("itemKey", keys.join(","))])
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(Error::msg(format!("Deleting items failed (HTTP {status}): {body}")));
    }
    Ok(())
}

/// Full attachment upload: create the attachment item, authorize the upload,
/// send the bytes, register the upload. Returns the attachment item key.
/// Removes the local file on success (the PDF lives in Zotero from then on).
pub async fn upload_attachment(
    app: &AppHandle,
    state: &AppState,
    parent_key: &str,
    file_path: &str,
    filename: &str,
) -> Result<String> {
    let base = library_base(state).await?;
    let key = api_key(state).await;

    // 1. Create the attachment item.
    let payload = json!([{
        "itemType": "attachment",
        "linkMode": "imported_file",
        "parentItem": parent_key,
        "title": "Full Text PDF",
        "filename": filename,
        "contentType": "application/pdf",
        "tags": [],
        "relations": {},
    }]);
    let resp = state
        .http
        .post(format!("{base}/items"))
        .header("Zotero-API-Key", &key)
        .header("Zotero-API-Version", "3")
        .header("Zotero-Write-Token", write_token())
        .json(&payload)
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
    let att_key = att["key"]
        .as_str()
        .or_else(|| att["data"]["key"].as_str())
        .ok_or_else(|| Error::msg(format!("Unexpected Zotero response: {body}")))?
        .to_string();
    log(app, "info", format!("Created attachment item {att_key}"));

    // 2. Get upload authorization.
    let bytes = std::fs::read(file_path)?;
    let md5hex = format!("{:x}", md5::compute(&bytes));
    let mtime = std::fs::metadata(file_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or_else(now_ms);
    let form = [
        ("md5", md5hex.clone()),
        ("filename", filename.to_string()),
        ("filesize", bytes.len().to_string()),
        ("mtime", mtime.to_string()),
    ];
    let resp = state
        .http
        .post(format!("{base}/items/{att_key}/file"))
        .header("Zotero-API-Key", &key)
        .header("Zotero-API-Version", "3")
        .header("If-None-Match", "*")
        .form(&form)
        .send()
        .await?;
    let status = resp.status();
    let auth: Value = resp.json().await?;
    if !status.is_success() {
        return Err(Error::msg(format!(
            "Upload authorization failed (HTTP {status}): {auth}"
        )));
    }

    if auth["exists"].as_i64() == Some(1) {
        log(app, "info", "File already exists in Zotero storage — skipping upload");
    } else {
        // 3. Upload prefix + bytes + suffix to the storage URL.
        let url = auth["url"]
            .as_str()
            .ok_or_else(|| Error::msg(format!("No upload URL in authorization: {auth}")))?;
        let content_type = auth["contentType"].as_str().unwrap_or("application/pdf");
        let prefix = auth["prefix"].as_str().unwrap_or("");
        let suffix = auth["suffix"].as_str().unwrap_or("");
        let upload_key = auth["uploadKey"]
            .as_str()
            .ok_or_else(|| Error::msg("No uploadKey in authorization"))?;

        let mut body_bytes = Vec::with_capacity(prefix.len() + bytes.len() + suffix.len());
        body_bytes.extend_from_slice(prefix.as_bytes());
        body_bytes.extend_from_slice(&bytes);
        body_bytes.extend_from_slice(suffix.as_bytes());

        log(
            app,
            "info",
            format!("Uploading {} KB to Zotero storage…", bytes.len() / 1024),
        );
        let resp = state
            .http
            .post(url)
            .header("Content-Type", content_type)
            .body(body_bytes)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Error::msg(format!(
                "Storage upload failed (HTTP {})",
                resp.status()
            )));
        }

        // 4. Register the upload.
        let resp = state
            .http
            .post(format!("{base}/items/{att_key}/file"))
            .header("Zotero-API-Key", &key)
            .header("Zotero-API-Version", "3")
            .header("If-None-Match", "*")
            .form(&[("upload", upload_key)])
            .send()
            .await?;
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(Error::msg(format!("Registering upload failed: {body}")));
        }
    }

    // The PDF now lives in Zotero — no need to keep the local copy.
    let _ = std::fs::remove_file(file_path);
    log(app, "info", format!("Attachment uploaded and registered for {parent_key}"));
    Ok(att_key)
}
