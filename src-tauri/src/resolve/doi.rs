//! DOI resolution via CrossRef, with a DataCite fallback for datasets and
//! other non-CrossRef DOIs.

use super::{first_str, s_of, set_if, strip_tags, Resolved};
use crate::state::AppState;
use crate::{log, Error, Result};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tauri::AppHandle;

fn enc(s: &str) -> String {
    utf8_percent_encode(s, NON_ALPHANUMERIC).to_string()
}

fn date_from_parts(v: &Value) -> Option<String> {
    let parts = v["date-parts"][0].as_array()?;
    let nums: Vec<String> = parts
        .iter()
        .filter_map(|p| p.as_i64())
        .map(|n| n.to_string())
        .collect();
    if nums.is_empty() {
        return None;
    }
    Some(match nums.len() {
        1 => nums[0].clone(),
        2 => format!("{}-{:0>2}", nums[0], nums[1]),
        _ => format!("{}-{:0>2}-{:0>2}", nums[0], nums[1], nums[2]),
    })
}

fn crossref_creators(msg: &Value, field: &str, creator_type: &str) -> Vec<Value> {
    msg[field]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|a| {
                    if let (Some(family), given) = (a["family"].as_str(), a["given"].as_str()) {
                        json!({
                            "creatorType": creator_type,
                            "firstName": given.unwrap_or(""),
                            "lastName": family,
                        })
                    } else {
                        json!({
                            "creatorType": creator_type,
                            "name": a["name"].as_str().unwrap_or("Unknown"),
                        })
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn map_crossref(msg: &Value, doi: &str) -> (Value, Vec<String>) {
    let cr_type = msg["type"].as_str().unwrap_or("journal-article");
    let item_type = match cr_type {
        "journal-article" => "journalArticle",
        "proceedings-article" => "conferencePaper",
        "book-chapter" | "book-section" | "book-part" => "bookSection",
        "book" | "monograph" | "edited-book" | "reference-book" => "book",
        "posted-content" => "preprint",
        "report" => "report",
        "dissertation" => "thesis",
        _ => "journalArticle",
    };

    let mut item = json!({ "itemType": item_type });
    set_if(&mut item, "title", first_str(&msg["title"]));
    let mut creators = crossref_creators(msg, "author", "author");
    creators.extend(crossref_creators(msg, "editor", "editor"));
    if !creators.is_empty() {
        item["creators"] = Value::Array(creators);
    }
    if let Some(abs) = msg["abstract"].as_str() {
        item["abstractNote"] = Value::String(strip_tags(abs));
    }
    set_if(
        &mut item,
        "date",
        date_from_parts(&msg["issued"]).or_else(|| date_from_parts(&msg["published"])),
    );
    let container = first_str(&msg["container-title"]);
    match item_type {
        "journalArticle" => {
            set_if(&mut item, "publicationTitle", container);
            set_if(
                &mut item,
                "journalAbbreviation",
                first_str(&msg["short-container-title"]),
            );
            set_if(&mut item, "volume", s_of(&msg["volume"]));
            set_if(&mut item, "issue", s_of(&msg["issue"]));
            set_if(&mut item, "pages", s_of(&msg["page"]));
            set_if(&mut item, "ISSN", first_str(&msg["ISSN"]));
        }
        "conferencePaper" => {
            set_if(&mut item, "proceedingsTitle", container);
            set_if(&mut item, "publisher", s_of(&msg["publisher"]));
            set_if(&mut item, "pages", s_of(&msg["page"]));
        }
        "bookSection" => {
            set_if(&mut item, "bookTitle", container);
            set_if(&mut item, "publisher", s_of(&msg["publisher"]));
            set_if(&mut item, "pages", s_of(&msg["page"]));
            set_if(&mut item, "ISBN", first_str(&msg["ISBN"]));
        }
        "book" => {
            set_if(&mut item, "publisher", s_of(&msg["publisher"]));
            set_if(&mut item, "place", s_of(&msg["publisher-location"]));
            set_if(&mut item, "ISBN", first_str(&msg["ISBN"]));
        }
        "preprint" => {
            set_if(&mut item, "repository", s_of(&msg["publisher"]));
        }
        _ => {
            set_if(&mut item, "publisher", s_of(&msg["publisher"]));
        }
    }
    item["DOI"] = Value::String(doi.to_string());
    set_if(&mut item, "language", s_of(&msg["language"]));
    item["url"] =
        Value::String(s_of(&msg["URL"]).unwrap_or_else(|| format!("https://doi.org/{doi}")));
    item["libraryCatalog"] = Value::String("CrossRef".into());

    // PDF links published by CrossRef.
    let mut candidates = Vec::new();
    if let Some(links) = msg["link"].as_array() {
        for l in links {
            if l["content-type"].as_str() == Some("application/pdf") {
                if let Some(u) = l["URL"].as_str() {
                    candidates.push(u.to_string());
                }
            }
        }
    }
    (item, candidates)
}

pub(super) async fn resolve_doi(
    app: &AppHandle,
    state: &AppState,
    doi: &str,
) -> Result<Resolved> {
    log(app, "info", format!("Resolving DOI {doi} via CrossRef"));
    state.throttle("api.crossref.org").await;
    let email = state.settings.read().await.contact_email.clone();
    let mut req = state
        .http
        .get(format!("https://api.crossref.org/works/{}", enc(doi)));
    if !email.is_empty() {
        req = req.query(&[("mailto", email.as_str())]);
    }
    let resp = req.send().await?;
    if resp.status().is_success() {
        let body: Value = resp.json().await?;
        let (item, candidates) = map_crossref(&body["message"], doi);
        return Ok(Resolved {
            item,
            pdf_candidates: candidates,
            landing_url: Some(format!("https://doi.org/{doi}")),
            kind: "doi".into(),
        });
    }
    log(
        app,
        "warn",
        format!(
            "CrossRef has no record for {doi} (HTTP {}), trying DataCite",
            resp.status()
        ),
    );

    // DataCite fallback (datasets, preprints, etc.)
    state.throttle("api.datacite.org").await;
    let resp = state
        .http
        .get(format!("https://api.datacite.org/dois/{}", enc(doi)))
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(Error::msg(format!(
            "Neither CrossRef nor DataCite know DOI {doi}"
        )));
    }
    let body: Value = resp.json().await?;
    let attr = &body["data"]["attributes"];
    let mut item = json!({ "itemType": "journalArticle", "DOI": doi });
    set_if(&mut item, "title", s_of(&attr["titles"][0]["title"]));
    let creators: Vec<Value> = attr["creators"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|c| {
                    json!({
                        "creatorType": "author",
                        "firstName": c["givenName"].as_str().unwrap_or(""),
                        "lastName": c["familyName"].as_str().or(c["name"].as_str()).unwrap_or("Unknown"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    if !creators.is_empty() {
        item["creators"] = Value::Array(creators);
    }
    if let Some(y) = attr["publicationYear"].as_i64() {
        item["date"] = Value::String(y.to_string());
    }
    set_if(&mut item, "publicationTitle", s_of(&attr["container"]["title"]));
    set_if(&mut item, "url", s_of(&attr["url"]));
    item["libraryCatalog"] = Value::String("DataCite".into());
    Ok(Resolved {
        item,
        pdf_candidates: vec![],
        landing_url: Some(format!("https://doi.org/{doi}")),
        kind: "doi".into(),
    })
}
