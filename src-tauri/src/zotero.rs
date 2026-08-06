//! Zotero Web API v3 client: library sync, item/collection writes, and the
//! three-step file upload flow for attachments.

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

async fn library_base(state: &AppState) -> Result<String> {
    let s = state.settings.read().await;
    if s.zotero_api_key.is_empty() || s.zotero_user_id.is_empty() {
        return Err(Error::msg(
            "Zotero credentials are not configured — open Settings first",
        ));
    }
    let kind = if s.library_type == "group" { "groups" } else { "users" };
    Ok(format!("{API}/{kind}/{}", s.zotero_user_id))
}

async fn api_key(state: &AppState) -> String {
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

fn header_u64(resp: &reqwest::Response, name: &str) -> u64 {
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

/// Paginated GET over a library endpoint. Returns (objects, library_version).
async fn fetch_all(
    app: &AppHandle,
    state: &AppState,
    path: &str,
    since: Option<u64>,
    label: &str,
) -> Result<(Vec<Value>, u64)> {
    let base = library_base(state).await?;
    let key = api_key(state).await;
    let mut out: Vec<Value> = Vec::new();
    let mut start = 0usize;
    let mut version = 0u64;
    loop {
        let mut req = state
            .http
            .get(format!("{base}/{path}"))
            .header("Zotero-API-Key", &key)
            .header("Zotero-API-Version", "3")
            .query(&[("format", "json"), ("include", "data")])
            .query(&[("limit", "100"), ("start", &start.to_string())]);
        if let Some(v) = since {
            req = req.query(&[("since", &v.to_string())]);
        }
        let resp = req.send().await?;
        if resp.status().as_u16() == 429 {
            let wait = header_u64(&resp, "retry-after").max(2);
            log(app, "warn", format!("Zotero rate limit hit, backing off {wait}s"));
            tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
            continue;
        }
        if !resp.status().is_success() {
            return Err(Error::msg(format!(
                "Zotero API error fetching {path}: HTTP {}",
                resp.status()
            )));
        }
        if version == 0 {
            version = header_u64(&resp, "last-modified-version");
        }
        let total = header_u64(&resp, "total-results") as usize;
        let batch: Vec<Value> = resp.json().await?;
        let n = batch.len();
        out.extend(batch);
        start += n;
        let _ = app.emit_progress(label, out.len(), total.max(out.len()));
        if n < 100 || start >= total {
            break;
        }
    }
    Ok((out, version))
}

trait ProgressExt {
    fn emit_progress(&self, phase: &str, done: usize, total: usize) -> tauri::Result<()>;
}
impl ProgressExt for AppHandle {
    fn emit_progress(&self, phase: &str, done: usize, total: usize) -> tauri::Result<()> {
        use tauri::Emitter;
        self.emit(
            "sync-progress",
            json!({ "phase": phase, "done": done, "total": total }),
        )
    }
}

fn merge_by_key(existing: &mut Vec<Value>, incoming: Vec<Value>) {
    for obj in incoming {
        let key = obj["key"].as_str().map(|s| s.to_string());
        match key {
            Some(k) => {
                if let Some(slot) = existing
                    .iter_mut()
                    .find(|e| e["key"].as_str() == Some(k.as_str()))
                {
                    *slot = obj;
                } else {
                    existing.push(obj);
                }
            }
            None => existing.push(obj),
        }
    }
}

fn remove_keys(list: &mut Vec<Value>, keys: &[String]) {
    list.retain(|o| match o["key"].as_str() {
        Some(k) => !keys.iter().any(|d| d == k),
        None => true,
    });
}

/// Full or incremental sync. Incremental sync merges changed objects and
/// removes remotely-deleted ones without touching anything else, so local
/// items that have not reached the server yet are preserved.
pub async fn sync_library(app: &AppHandle, state: &AppState, full: bool) -> Result<LibraryCache> {
    let mut cache = load_cache(&state.data_dir);
    let full = full || cache.version == 0;
    let since = if full { None } else { Some(cache.version) };

    match since {
        None => log(app, "info", "Starting full library sync"),
        Some(v) => log(app, "info", format!("Starting incremental sync since version {v}")),
    }

    let (collections, v1) = fetch_all(app, state, "collections", since, "collections").await?;
    log(app, "info", format!("Fetched {} collection(s)", collections.len()));
    let (items, v2) = fetch_all(app, state, "items", since, "items").await?;
    log(app, "info", format!("Fetched {} item(s)", items.len()));

    if full {
        cache.collections = collections;
        cache.items = items;
    } else {
        merge_by_key(&mut cache.collections, collections);
        merge_by_key(&mut cache.items, items);
        // Remove objects deleted on the server since our version.
        if let Some(v) = since {
            let base = library_base(state).await?;
            let key = api_key(state).await;
            let resp = state
                .http
                .get(format!("{base}/deleted"))
                .header("Zotero-API-Key", &key)
                .header("Zotero-API-Version", "3")
                .query(&[("since", &v.to_string())])
                .send()
                .await?;
            if resp.status().is_success() {
                let deleted: Value = resp.json().await?;
                let to_vec = |v: &Value| -> Vec<String> {
                    v.as_array()
                        .map(|a| {
                            a.iter()
                                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                                .collect()
                        })
                        .unwrap_or_default()
                };
                let dc = to_vec(&deleted["collections"]);
                let di = to_vec(&deleted["items"]);
                if !dc.is_empty() || !di.is_empty() {
                    log(
                        app,
                        "info",
                        format!("Removing {} deleted item(s), {} collection(s)", di.len(), dc.len()),
                    );
                }
                remove_keys(&mut cache.collections, &dc);
                remove_keys(&mut cache.items, &di);
            }
        }
    }

    cache.version = cache.version.max(v1).max(v2);
    cache.last_sync_ms = now_ms();
    save_cache(&state.data_dir, &cache)?;
    log(
        app,
        "info",
        format!(
            "Sync complete — {} items, {} collections (library version {})",
            cache.items.len(),
            cache.collections.len(),
            cache.version
        ),
    );
    Ok(cache)
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
