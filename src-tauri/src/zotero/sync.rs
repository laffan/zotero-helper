//! The sync engine: paginated fetches with per-page retry/backoff, a
//! resumable (checkpointed) initial download for very large libraries,
//! incremental `?since=` syncs, and folder-scoped syncs.
//!
//! The initial download of a 10k+ item library takes long enough that
//! flaky Wi-Fi or iPad app suspension will interrupt it. Every fetched
//! page is appended to an on-disk journal (`sync-checkpoint.jsonl`), so
//! a restart resumes at the last page instead of starting over. Pages
//! are requested in `dateAdded asc` order, which is append-only stable —
//! items added mid-download land at the tail rather than shifting pages
//! we already fetched. Anything *modified* during the long fetch is
//! caught by the incremental catch-up pass that runs right after.

use super::{
    api_key, header_u64, library_base, load_cache, now_ms, save_cache, LibraryCache, TagColor,
};
use crate::state::AppState;
use crate::{log, Error, Result};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const PAGE: usize = 100;
const MAX_ATTEMPTS: u32 = 4;
const CHECKPOINT_MAX_AGE_MS: u64 = 24 * 3600 * 1000;

struct FetchedPage {
    items: Vec<Value>,
    version: u64,
    total: usize,
}

async fn fetch_page(
    state: &AppState,
    base: &str,
    key: &str,
    path: &str,
    since: Option<u64>,
    start: usize,
    stable_order: bool,
) -> Result<FetchedPage> {
    let mut req = state
        .http
        .get(format!("{base}/{path}"))
        .header("Zotero-API-Key", key)
        .header("Zotero-API-Version", "3")
        .query(&[("format", "json"), ("include", "data")])
        .query(&[("limit", &PAGE.to_string()), ("start", &start.to_string())]);
    if stable_order {
        req = req.query(&[("sort", "dateAdded"), ("direction", "asc")]);
    }
    if let Some(v) = since {
        // Zotero leaves the trash out of every listing unless asked, so
        // without this an item moved to the trash is simply never seen
        // again. With it, the item arrives marked `deleted` and
        // drop_trashed takes it out of the cache.
        req = req.query(&[("since", &v.to_string())]).query(&[("includeTrashed", "1")]);
    }
    let resp = req.send().await?;
    let status = resp.status();
    if status.as_u16() == 429 {
        let wait = header_u64(&resp, "retry-after").max(2);
        return Err(Error::msg(format!("Zotero rate limit (retry after {wait}s)")));
    }
    if !status.is_success() {
        return Err(Error::msg(format!("Zotero API error on {path}: HTTP {status}")));
    }
    let version = header_u64(&resp, "last-modified-version");
    let total = header_u64(&resp, "total-results") as usize;
    let items: Vec<Value> = resp.json().await?;
    Ok(FetchedPage { items, version, total })
}

/// One page, up to MAX_ATTEMPTS tries with exponential backoff. Slow
/// networks and iPad app suspension make one-shot requests too fragile
/// for hour-long initial downloads.
async fn fetch_page_retry(
    app: &AppHandle,
    state: &AppState,
    base: &str,
    key: &str,
    path: &str,
    since: Option<u64>,
    start: usize,
    stable_order: bool,
) -> Result<FetchedPage> {
    let mut delay = 2u64;
    for attempt in 1..=MAX_ATTEMPTS {
        match fetch_page(state, base, key, path, since, start, stable_order).await {
            Ok(page) => return Ok(page),
            Err(e) if attempt < MAX_ATTEMPTS => {
                log(
                    app,
                    "warn",
                    format!("Fetching {path} (start={start}) failed: {e} — retry {attempt}/{} in {delay}s", MAX_ATTEMPTS - 1),
                );
                tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
                delay = (delay * 2).min(30);
            }
            Err(e) => return Err(e),
        }
    }
    unreachable!()
}

fn emit_progress(app: &AppHandle, phase: &str, done: usize, total: usize) {
    use tauri::Emitter;
    let _ = app.emit(
        "sync-progress",
        json!({ "phase": phase, "done": done, "total": total }),
    );
}

pub(super) fn merge_by_key(existing: &mut Vec<Value>, incoming: Vec<Value>) {
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

/// Is `obj` in Zotero's trash? Items carry `deleted: 1`, collections
/// `deleted: true`.
fn is_trashed(obj: &Value) -> bool {
    match &obj["data"]["deleted"] {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_u64() != Some(0),
        _ => false,
    }
}

/// Take everything in Zotero's trash out of `list`; returns how many
/// went. The app has no trash of its own, so a trashed object is a
/// deleted one here — as a full refresh, which never sees the trash,
/// already has it.
fn drop_trashed(list: &mut Vec<Value>) -> usize {
    let before = list.len();
    list.retain(|o| !is_trashed(o));
    before - list.len()
}

/// Fetch every object of `path` (optionally since a version).
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
        let page = fetch_page_retry(app, state, &base, &key, path, since, start, false).await?;
        if version == 0 {
            version = page.version;
        }
        let n = page.items.len();
        merge_by_key(&mut out, page.items);
        start += n;
        emit_progress(app, label, out.len(), page.total.max(out.len()));
        if n < PAGE || start >= page.total {
            break;
        }
    }
    Ok((out, version))
}

// ---------------------------------------------------------------- tag colors

/// Colored (a.k.a. numbered) tags are a *library setting*, not item
/// data: `settings/tagColors` holds an ordered list of {name, color},
/// which is the 1..9 position Zotero shows them in. An unset preference
/// answers 404, which simply means "no colored tags".
async fn fetch_tag_colors(state: &AppState) -> Result<Vec<TagColor>> {
    let base = library_base(state).await?;
    let resp = state
        .http
        .get(format!("{base}/settings/tagColors"))
        .header("Zotero-API-Key", api_key(state).await)
        .header("Zotero-API-Version", "3")
        .send()
        .await?;
    if resp.status().as_u16() == 404 {
        return Ok(Vec::new());
    }
    if !resp.status().is_success() {
        return Err(Error::msg(format!(
            "Zotero settings fetch failed (HTTP {})",
            resp.status()
        )));
    }
    let body: Value = resp.json().await?;
    Ok(serde_json::from_value(body["value"].clone()).unwrap_or_default())
}

/// Refresh the cached colors in place. Never fails a sync — on error the
/// previously known colors stay as they were.
async fn refresh_tag_colors(app: &AppHandle, state: &AppState, cache: &mut LibraryCache) {
    match fetch_tag_colors(state).await {
        Ok(colors) => cache.tag_colors = colors,
        Err(e) => log(app, "debug", format!("Tag colors unavailable: {e}")),
    }
}

// ---------------------------------------------------------------- checkpoint

fn checkpoint_path(data_dir: &Path) -> PathBuf {
    data_dir.join("sync-checkpoint.jsonl")
}

/// Journal: line 0 is `{"version":…,"startedMs":…}`, each further line
/// is one fetched page (a JSON array). A truncated final line (crash
/// mid-write) is simply ignored.
fn load_checkpoint(path: &Path) -> Option<(u64, u64, usize, Vec<Value>)> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut lines = text.lines();
    let header: Value = serde_json::from_str(lines.next()?).ok()?;
    let version = header["version"].as_u64()?;
    let started = header["startedMs"].as_u64()?;
    if version == 0 {
        return None;
    }
    let mut raw = 0usize;
    let mut merged: Vec<Value> = Vec::new();
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(page) = serde_json::from_str::<Vec<Value>>(line) else {
            break;
        };
        raw += page.len();
        merge_by_key(&mut merged, page);
    }
    Some((version, started, raw, merged))
}

fn start_checkpoint(path: &Path, version: u64) -> Result<()> {
    std::fs::write(
        path,
        format!(
            "{}\n",
            json!({ "version": version, "startedMs": now_ms() })
        ),
    )?;
    Ok(())
}

fn append_checkpoint_page(path: &Path, page: &[Value]) -> Result<()> {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().append(true).open(path)?;
    f.write_all(serde_json::to_string(page)?.as_bytes())?;
    f.write_all(b"\n")?;
    Ok(())
}

/// The big one: fetch every item, journaling each page so an interrupted
/// download resumes instead of restarting. Returns (items, the library
/// version captured when the download STARTED — the safe baseline for
/// the follow-up incremental pass).
async fn fetch_items_resumable(app: &AppHandle, state: &AppState) -> Result<(Vec<Value>, u64)> {
    let base = library_base(state).await?;
    let key = api_key(state).await;
    let ckpt = checkpoint_path(&state.data_dir);

    let mut items: Vec<Value> = Vec::new();
    let mut fetched = 0usize;
    let mut baseline = 0u64;
    if let Some((version, started, raw, merged)) = load_checkpoint(&ckpt) {
        if now_ms().saturating_sub(started) < CHECKPOINT_MAX_AGE_MS {
            log(
                app,
                "info",
                format!("Resuming interrupted download at item {raw}"),
            );
            baseline = version;
            fetched = raw;
            items = merged;
        } else {
            log(app, "info", "Found a stale sync checkpoint — starting fresh");
            let _ = std::fs::remove_file(&ckpt);
        }
    }

    loop {
        let page =
            fetch_page_retry(app, state, &base, &key, "items", None, fetched, true).await?;
        if baseline == 0 {
            baseline = page.version.max(1);
            start_checkpoint(&ckpt, baseline)?;
        }
        let n = page.items.len();
        if let Err(e) = append_checkpoint_page(&ckpt, &page.items) {
            log(app, "warn", format!("Could not journal sync progress: {e}"));
        }
        merge_by_key(&mut items, page.items);
        fetched += n;
        emit_progress(app, "items", fetched, page.total.max(fetched));
        if n < PAGE || fetched >= page.total {
            break;
        }
    }
    let _ = std::fs::remove_file(&ckpt);
    Ok((items, baseline))
}

// ---------------------------------------------------------------- syncs

/// Merge everything changed since `cache.version`, apply remote
/// deletions, and advance the version. Shared by incremental syncs and
/// the post-download catch-up pass.
async fn incremental_pass(
    app: &AppHandle,
    state: &AppState,
    cache: &mut LibraryCache,
) -> Result<()> {
    let since = cache.version;
    let (collections, v1) = fetch_all(app, state, "collections", Some(since), "collections").await?;
    let (items, v2) = fetch_all(app, state, "items", Some(since), "items").await?;
    if !collections.is_empty() || !items.is_empty() {
        log(
            app,
            "info",
            format!("Merged {} changed item(s), {} collection(s)", items.len(), collections.len()),
        );
    }
    merge_by_key(&mut cache.collections, collections);
    merge_by_key(&mut cache.items, items);

    let base = library_base(state).await?;
    let key = api_key(state).await;
    let resp = state
        .http
        .get(format!("{base}/deleted"))
        .header("Zotero-API-Key", &key)
        .header("Zotero-API-Version", "3")
        .query(&[("since", &since.to_string())])
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
    let tc = drop_trashed(&mut cache.collections);
    let ti = drop_trashed(&mut cache.items);
    if tc > 0 || ti > 0 {
        log(
            app,
            "info",
            format!("Removing {ti} trashed item(s), {tc} collection(s)"),
        );
    }

    cache.version = cache.version.max(v1).max(v2);
    cache.last_sync_ms = now_ms();
    save_cache(&state.data_dir, cache)?;
    Ok(())
}

/// Full or incremental sync. Incremental sync merges changed objects and
/// removes remotely-deleted ones without touching anything else, so
/// local items that have not reached the server yet are preserved.
pub async fn sync_library(app: &AppHandle, state: &AppState, full: bool) -> Result<LibraryCache> {
    let mut cache = load_cache(&state.data_dir);
    let full = full || cache.version == 0;
    refresh_tag_colors(app, state, &mut cache).await;

    if full {
        log(app, "info", "Starting full library sync");
        let (collections, vc) = fetch_all(app, state, "collections", None, "collections").await?;
        log(app, "info", format!("Fetched {} collection(s)", collections.len()));
        let (items, vi) = fetch_items_resumable(app, state).await?;
        log(app, "info", format!("Fetched {} item(s)", items.len()));
        cache.collections = collections;
        cache.items = items;
        // `/items` already leaves the trash out; `/collections` does not.
        drop_trashed(&mut cache.collections);
        // Baseline at the *earlier* of the two capture points, so the
        // catch-up pass re-fetches anything that changed in between.
        cache.version = vc.min(vi).max(1);
        cache.last_sync_ms = now_ms();
        save_cache(&state.data_dir, &cache)?;
        // Catch changes made while the long download ran. The main data
        // is already saved — a hiccup here shouldn't discard it.
        if let Err(e) = incremental_pass(app, state, &mut cache).await {
            log(app, "warn", format!("Post-download catch-up failed (will heal on next sync): {e}"));
        }
    } else {
        log(
            app,
            "info",
            format!("Starting incremental sync since version {}", cache.version),
        );
        incremental_pass(app, state, &mut cache).await?;
    }

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

/// Folder-scoped sync: fetch this collection's items changed since the
/// cached library version and merge them in, then take out what has
/// left the folder (see reconcile_folder). Deliberately does NOT
/// advance the cached version — only whole-library syncs may do that,
/// otherwise changes elsewhere in the library would be skipped by the
/// next incremental sync.
pub async fn sync_collection(
    app: &AppHandle,
    state: &AppState,
    collection_key: &str,
) -> Result<LibraryCache> {
    let mut cache = load_cache(&state.data_dir);
    if cache.version == 0 {
        return Err(Error::msg("Run a full sync first — there is no local library yet"));
    }
    log(
        app,
        "info",
        format!("Syncing folder {collection_key} (changes since v{})", cache.version),
    );
    refresh_tag_colors(app, state, &mut cache).await;
    let before = folder_keys(&cache.items, collection_key);
    let path = format!("collections/{collection_key}/items");
    let (items, _) = fetch_all(app, state, &path, Some(cache.version), "folder").await?;
    let changed = items.len();
    merge_by_key(&mut cache.items, items);
    reconcile_folder(app, state, &mut cache, collection_key).await?;
    drop_trashed(&mut cache.items);
    let after = folder_keys(&cache.items, collection_key);
    let removed = before.difference(&after).count();
    cache.last_sync_ms = now_ms();
    save_cache(&state.data_dir, &cache)?;
    log(
        app,
        "info",
        format!("Folder sync complete — {changed} changed item(s), {removed} removed"),
    );
    Ok(cache)
}

/// Keys of the cached items filed under `collection_key`.
fn folder_keys(items: &[Value], collection_key: &str) -> HashSet<String> {
    items
        .iter()
        .filter(|i| {
            i["data"]["collections"]
                .as_array()
                .is_some_and(|cs| cs.iter().any(|c| c.as_str() == Some(collection_key)))
        })
        .filter_map(|i| i["key"].as_str().map(str::to_string))
        .collect()
}

/// Bring the cache's idea of what is in a folder back in line with
/// Zotero's. An item removed from the folder, or deleted outright, never
/// turns up in the folder's `?since=` listing — it is no longer in the
/// folder — so ask Zotero for the keys the folder holds now, and look up
/// each cached item that claims the folder but is not among them. What
/// comes back is merged (its `collections` no longer name the folder, or
/// it is marked trashed); what does not come back is gone from Zotero
/// and is removed.
async fn reconcile_folder(
    app: &AppHandle,
    state: &AppState,
    cache: &mut LibraryCache,
    collection_key: &str,
) -> Result<()> {
    let base = library_base(state).await?;
    let key = api_key(state).await;
    let resp = state
        .http
        .get(format!("{base}/collections/{collection_key}/items"))
        .header("Zotero-API-Key", &key)
        .header("Zotero-API-Version", "3")
        .query(&[("format", "keys")])
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        return Err(Error::msg(format!(
            "Zotero API error listing folder {collection_key}: HTTP {status}"
        )));
    }
    let text = resp.text().await?;
    let present: HashSet<&str> = text.lines().map(str::trim).filter(|k| !k.is_empty()).collect();
    let stale: Vec<String> = folder_keys(&cache.items, collection_key)
        .into_iter()
        .filter(|k| !present.contains(k.as_str()))
        .collect();
    if stale.is_empty() {
        return Ok(());
    }

    // Zotero answers at most 50 keys per `itemKey` request.
    let mut found: Vec<Value> = Vec::new();
    for chunk in stale.chunks(50) {
        let resp = state
            .http
            .get(format!("{base}/items"))
            .header("Zotero-API-Key", &key)
            .header("Zotero-API-Version", "3")
            .query(&[("format", "json"), ("include", "data"), ("includeTrashed", "1")])
            .query(&[("itemKey", chunk.join(","))])
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            return Err(Error::msg(format!(
                "Zotero API error looking up items: HTTP {status}"
            )));
        }
        let page: Vec<Value> = resp.json().await?;
        found.extend(page);
    }
    let gone: Vec<String> = stale
        .into_iter()
        .filter(|k| !found.iter().any(|f| f["key"].as_str() == Some(k.as_str())))
        .collect();
    log(
        app,
        "info",
        format!(
            "{} item(s) left the folder, {} of them deleted from Zotero",
            found.len() + gone.len(),
            gone.len()
        ),
    );
    merge_by_key(&mut cache.items, found);
    remove_keys(&mut cache.items, &gone);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trashed_items_and_collections_are_dropped() {
        let mut list = vec![
            json!({ "key": "AAAA", "data": { "deleted": 1 } }),
            json!({ "key": "BBBB", "data": { "deleted": true } }),
            json!({ "key": "CCCC", "data": { "deleted": 0 } }),
            json!({ "key": "DDDD", "data": {} }),
        ];
        assert_eq!(drop_trashed(&mut list), 2);
        let keys: Vec<_> = list.iter().map(|o| o["key"].as_str().unwrap()).collect();
        assert_eq!(keys, ["CCCC", "DDDD"]);
    }

    #[test]
    fn folder_keys_reads_each_items_collections() {
        let items = vec![
            json!({ "key": "AAAA", "data": { "collections": ["F1", "F2"] } }),
            json!({ "key": "BBBB", "data": { "collections": ["F2"] } }),
            json!({ "key": "CCCC", "data": { "parentItem": "AAAA" } }),
        ];
        let keys = folder_keys(&items, "F1");
        assert_eq!(keys, HashSet::from(["AAAA".to_string()]));
        assert_eq!(folder_keys(&items, "F2").len(), 2);
    }
}
