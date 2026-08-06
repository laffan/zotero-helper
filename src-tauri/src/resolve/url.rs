//! Generic web-page resolution: scrape Highwire `citation_*` meta tags,
//! upgrading to a CrossRef lookup when the page declares a DOI.

use super::{classify, doi, meta_first, meta_values, set_if, split_name, strip_tags};
use super::{Identifier, Resolved};
use crate::state::{host_of, AppState};
use crate::{log, Result};
use regex::Regex;
use serde_json::{json, Value};
use tauri::AppHandle;

pub(super) async fn resolve_url(
    app: &AppHandle,
    state: &AppState,
    url: &str,
) -> Result<Resolved> {
    log(app, "info", format!("Fetching page metadata from {url}"));
    state.throttle(&host_of(url)).await;
    let resp = state.http.get(url).send().await?;
    let final_url = resp.url().to_string();
    let html = resp.text().await?;

    // If the page declares a DOI, resolve through CrossRef for better data.
    if let Some(raw_doi) =
        meta_first(&html, "citation_doi").or_else(|| meta_first(&html, "dc.identifier"))
    {
        let d = raw_doi.trim_start_matches("doi:").trim().to_string();
        if classify(&d) == Some(Identifier::Doi(d.clone())) {
            log(app, "info", format!("Page declares DOI {d} — using CrossRef"));
            let mut resolved = doi::resolve_doi(app, state, &d).await?;
            if let Some(pdf) = meta_first(&html, "citation_pdf_url") {
                resolved.pdf_candidates.insert(0, pdf);
            }
            resolved.landing_url = Some(final_url);
            return Ok(resolved);
        }
    }

    let mut item = json!({ "itemType": "webpage", "url": final_url });
    let title = meta_first(&html, "citation_title")
        .or_else(|| meta_first(&html, "og:title"))
        .or_else(|| {
            Regex::new(r"(?is)<title[^>]*>(.*?)</title>")
                .unwrap()
                .captures(&html)
                .map(|c| strip_tags(&c[1]))
        });
    set_if(&mut item, "title", title);
    let creators: Vec<Value> = meta_values(&html, "citation_author")
        .iter()
        .map(|a| split_name(a))
        .collect();
    if !creators.is_empty() {
        item["creators"] = Value::Array(creators);
    }
    set_if(
        &mut item,
        "date",
        meta_first(&html, "citation_publication_date")
            .or_else(|| meta_first(&html, "citation_date")),
    );
    set_if(
        &mut item,
        "abstractNote",
        meta_first(&html, "citation_abstract").or_else(|| meta_first(&html, "description")),
    );
    set_if(&mut item, "websiteTitle", meta_first(&html, "og:site_name"));

    let mut candidates = Vec::new();
    if let Some(pdf) = meta_first(&html, "citation_pdf_url") {
        candidates.push(pdf);
    }
    if final_url
        .to_ascii_lowercase()
        .split('?')
        .next()
        .unwrap_or("")
        .ends_with(".pdf")
    {
        candidates.push(final_url.clone());
    }
    Ok(Resolved {
        item,
        pdf_candidates: candidates,
        landing_url: Some(final_url),
        kind: "url".into(),
    })
}
