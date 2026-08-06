//! Automatic PDF discovery (Unpaywall, CrossRef links, landing-page meta
//! tags) and rate-limited downloading with validation.

use crate::resolve::meta_values;
use crate::state::{host_of, AppState};
use crate::{log, Error, Result};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedPdf {
    pub path: String,
    pub size: u64,
    pub filename: String,
}

fn push_unique(list: &mut Vec<String>, url: impl Into<String>) {
    let url = url.into();
    if !url.is_empty() && !list.contains(&url) {
        list.push(url);
    }
}

/// Assemble an ordered list of candidate PDF URLs for an item.
pub async fn find_candidates(
    app: &AppHandle,
    state: &AppState,
    doi: Option<String>,
    landing_url: Option<String>,
    seed: Vec<String>,
) -> Result<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for s in seed {
        push_unique(&mut out, s);
    }

    if let Some(doi) = doi.as_deref().filter(|d| !d.is_empty()) {
        // Unpaywall — the most reliable legal open-access index.
        let email = state.settings.read().await.contact_email.clone();
        if email.is_empty() {
            log(
                app,
                "warn",
                "No contact email configured — skipping Unpaywall (set one in Settings)",
            );
        } else {
            state.throttle("api.unpaywall.org").await;
            let url = format!(
                "https://api.unpaywall.org/v2/{}",
                utf8_percent_encode(doi, NON_ALPHANUMERIC)
            );
            match state.http.get(&url).query(&[("email", &email)]).send().await {
                Ok(resp) if resp.status().is_success() => {
                    let body: Value = resp.json().await.unwrap_or(Value::Null);
                    let mut locations: Vec<&Value> = Vec::new();
                    if body["best_oa_location"].is_object() {
                        locations.push(&body["best_oa_location"]);
                    }
                    if let Some(arr) = body["oa_locations"].as_array() {
                        locations.extend(arr.iter());
                    }
                    for loc in locations {
                        if let Some(u) = loc["url_for_pdf"].as_str() {
                            push_unique(&mut out, u);
                        }
                    }
                    if out.is_empty() {
                        log(app, "info", format!("Unpaywall: no open-access PDF for {doi}"));
                    } else {
                        log(app, "info", format!("Unpaywall found {} candidate(s)", out.len()));
                    }
                }
                Ok(resp) => log(app, "warn", format!("Unpaywall error HTTP {}", resp.status())),
                Err(e) => log(app, "warn", format!("Unpaywall unreachable: {e}")),
            }
        }
    }

    // Scrape the landing page for a citation_pdf_url meta tag.
    let landing = landing_url
        .clone()
        .or_else(|| doi.as_ref().map(|d| format!("https://doi.org/{d}")));
    if let Some(page) = landing {
        state.throttle(&host_of(&page)).await;
        match state.http.get(&page).send().await {
            Ok(resp) if resp.status().is_success() => {
                let base = resp.url().clone();
                if let Ok(html) = resp.text().await {
                    for pdf in meta_values(&html, "citation_pdf_url") {
                        // Resolve relative URLs against the final page URL.
                        let abs = base
                            .join(&pdf)
                            .map(|u| u.to_string())
                            .unwrap_or(pdf);
                        push_unique(&mut out, abs);
                    }
                }
            }
            Ok(resp) => log(
                app,
                "warn",
                format!("Landing page returned HTTP {} for {page}", resp.status()),
            ),
            Err(e) => log(app, "warn", format!("Could not fetch landing page: {e}")),
        }
    }

    Ok(out)
}

/// Download a URL, verify it is actually a PDF, and store it in the app's
/// temp directory. Rate-limited per host.
pub async fn download_pdf(
    app: &AppHandle,
    state: &AppState,
    url: &str,
    referer: Option<String>,
) -> Result<DownloadedPdf> {
    state.throttle(&host_of(url)).await;
    log(app, "info", format!("Downloading {url}"));

    let mut req = state
        .http
        .get(url)
        .header("Accept", "application/pdf,application/octet-stream,*/*");
    if let Some(r) = referer {
        req = req.header("Referer", r);
    }
    let resp = req.send().await?;
    if !resp.status().is_success() {
        return Err(Error::msg(format!(
            "Download failed: HTTP {} from {url}",
            resp.status()
        )));
    }
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let final_url = resp.url().to_string();
    let bytes = resp.bytes().await?;

    let looks_like_pdf = bytes.len() > 4 && &bytes[..5.min(bytes.len())] == b"%PDF-";
    if !looks_like_pdf && !content_type.contains("pdf") {
        return Err(Error::msg(format!(
            "The server returned {} instead of a PDF (probably a paywall or login page) — try the manual browser",
            if content_type.is_empty() { "unknown content".into() } else { content_type }
        )));
    }
    if !looks_like_pdf {
        return Err(Error::msg(
            "Response claimed to be a PDF but the file is not valid — try the manual browser",
        ));
    }

    let dir = state.tmp_dir();
    std::fs::create_dir_all(&dir)?;
    let filename = suggest_filename(&final_url);
    let path = dir.join(format!("{}-{}", crate::zotero::now_ms(), filename));
    std::fs::write(&path, &bytes)?;
    log(
        app,
        "info",
        format!("Saved PDF ({} KB) to temp storage", bytes.len() / 1024),
    );
    Ok(DownloadedPdf {
        path: path.to_string_lossy().to_string(),
        size: bytes.len() as u64,
        filename,
    })
}

pub fn suggest_filename(url: &str) -> String {
    let name = url
        .split('?')
        .next()
        .unwrap_or("")
        .rsplit('/')
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    let mut name = if name.is_empty() { "document".into() } else { name };
    // Keep the filename filesystem-safe.
    name = name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' })
        .collect();
    if !name.to_ascii_lowercase().ends_with(".pdf") {
        name.push_str(".pdf");
    }
    name
}
