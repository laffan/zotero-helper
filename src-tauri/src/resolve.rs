//! Resolve identifiers (DOI / ISBN / arXiv / URL) to Zotero item data using
//! CrossRef, DataCite, OpenLibrary, Google Books, the arXiv API, and
//! Highwire meta tags scraped from landing pages.

use crate::state::{host_of, AppState};
use crate::{log, Error, Result};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
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

pub async fn resolve(app: &AppHandle, state: &AppState, raw: &str) -> Result<Resolved> {
    let id = classify(raw)
        .ok_or_else(|| Error::msg(format!("Unrecognized identifier: “{raw}” (expected DOI, ISBN, arXiv ID, or URL)")))?;
    match id {
        Identifier::Doi(doi) => resolve_doi(app, state, &doi).await,
        Identifier::Isbn(isbn) => resolve_isbn(app, state, &isbn).await,
        Identifier::Arxiv(aid) => resolve_arxiv(app, state, &aid).await,
        Identifier::Url(url) => resolve_url(app, state, &url).await,
    }
}

fn enc(s: &str) -> String {
    utf8_percent_encode(s, NON_ALPHANUMERIC).to_string()
}

fn strip_tags(s: &str) -> String {
    let re = Regex::new(r"<[^>]+>").unwrap();
    let text = re.replace_all(s, " ");
    let decoded = html_escape::decode_html_entities(&text);
    Regex::new(r"\s+")
        .unwrap()
        .replace_all(decoded.trim(), " ")
        .to_string()
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

fn set_if(obj: &mut Value, key: &str, val: Option<String>) {
    if let Some(v) = val {
        if !v.is_empty() {
            obj[key] = Value::String(v);
        }
    }
}

fn s_of(v: &Value) -> Option<String> {
    v.as_str().map(|s| s.to_string())
}

fn first_str(v: &Value) -> Option<String> {
    v.as_array()
        .and_then(|a| a.first())
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
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
            set_if(&mut item, "journalAbbreviation", first_str(&msg["short-container-title"]));
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
    item["url"] = Value::String(
        s_of(&msg["URL"]).unwrap_or_else(|| format!("https://doi.org/{doi}")),
    );
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

async fn resolve_doi(app: &AppHandle, state: &AppState, doi: &str) -> Result<Resolved> {
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
        format!("CrossRef has no record for {doi} (HTTP {}), trying DataCite", resp.status()),
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
    set_if(&mut item, "title", first_str(&attr["titles"]).or_else(|| s_of(&attr["titles"][0]["title"])));
    if item["title"].is_null() {
        set_if(&mut item, "title", s_of(&attr["titles"][0]["title"]));
    }
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

fn split_name(full: &str) -> Value {
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

async fn resolve_isbn(app: &AppHandle, state: &AppState, isbn: &str) -> Result<Resolved> {
    log(app, "info", format!("Resolving ISBN {isbn} via Open Library"));
    state.throttle("openlibrary.org").await;
    let resp = state
        .http
        .get("https://openlibrary.org/api/books")
        .query(&[
            ("bibkeys", format!("ISBN:{isbn}")),
            ("format", "json".into()),
            ("jscmd", "data".into()),
        ])
        .send()
        .await?;
    if resp.status().is_success() {
        let body: Value = resp.json().await?;
        let rec = &body[format!("ISBN:{isbn}")];
        if rec.is_object() {
            let mut item = json!({ "itemType": "book", "ISBN": isbn });
            set_if(&mut item, "title", s_of(&rec["title"]));
            if let Some(sub) = rec["subtitle"].as_str() {
                if let Some(t) = item["title"].as_str() {
                    item["title"] = Value::String(format!("{t}: {sub}"));
                }
            }
            let creators: Vec<Value> = rec["authors"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| a["name"].as_str().map(split_name))
                        .collect()
                })
                .unwrap_or_default();
            if !creators.is_empty() {
                item["creators"] = Value::Array(creators);
            }
            set_if(
                &mut item,
                "publisher",
                rec["publishers"][0]["name"].as_str().map(String::from),
            );
            set_if(
                &mut item,
                "place",
                rec["publish_places"][0]["name"].as_str().map(String::from),
            );
            set_if(&mut item, "date", s_of(&rec["publish_date"]));
            if let Some(n) = rec["number_of_pages"].as_i64() {
                item["numPages"] = Value::String(n.to_string());
            }
            set_if(&mut item, "url", s_of(&rec["url"]));
            item["libraryCatalog"] = Value::String("Open Library".into());
            return Ok(Resolved {
                item,
                pdf_candidates: vec![],
                landing_url: s_of(&rec["url"]),
                kind: "isbn".into(),
            });
        }
    }

    log(app, "warn", "Open Library miss — trying Google Books");
    state.throttle("www.googleapis.com").await;
    let resp = state
        .http
        .get("https://www.googleapis.com/books/v1/volumes")
        .query(&[("q", format!("isbn:{isbn}"))])
        .send()
        .await?;
    let body: Value = resp.json().await?;
    let info = &body["items"][0]["volumeInfo"];
    if !info.is_object() {
        return Err(Error::msg(format!("No metadata found for ISBN {isbn}")));
    }
    let mut item = json!({ "itemType": "book", "ISBN": isbn });
    set_if(&mut item, "title", s_of(&info["title"]));
    if let Some(sub) = info["subtitle"].as_str() {
        if let Some(t) = item["title"].as_str() {
            item["title"] = Value::String(format!("{t}: {sub}"));
        }
    }
    let creators: Vec<Value> = info["authors"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|a| a.as_str().map(split_name))
                .collect()
        })
        .unwrap_or_default();
    if !creators.is_empty() {
        item["creators"] = Value::Array(creators);
    }
    set_if(&mut item, "publisher", s_of(&info["publisher"]));
    set_if(&mut item, "date", s_of(&info["publishedDate"]));
    if let Some(n) = info["pageCount"].as_i64() {
        item["numPages"] = Value::String(n.to_string());
    }
    set_if(&mut item, "abstractNote", s_of(&info["description"]));
    set_if(&mut item, "language", s_of(&info["language"]));
    item["libraryCatalog"] = Value::String("Google Books".into());
    Ok(Resolved {
        item,
        pdf_candidates: vec![],
        landing_url: s_of(&info["infoLink"]),
        kind: "isbn".into(),
    })
}

async fn resolve_arxiv(app: &AppHandle, state: &AppState, aid: &str) -> Result<Resolved> {
    log(app, "info", format!("Resolving arXiv:{aid}"));
    state.throttle("export.arxiv.org").await;
    let resp = state
        .http
        .get("https://export.arxiv.org/api/query")
        .query(&[("id_list", aid), ("max_results", "1")])
        .send()
        .await?;
    let xml = resp.text().await?;
    let entry_re = Regex::new(r"(?s)<entry>(.*?)</entry>").unwrap();
    let entry = entry_re
        .captures(&xml)
        .map(|c| c[1].to_string())
        .ok_or_else(|| Error::msg(format!("arXiv has no record for {aid}")))?;
    let cap1 = |pat: &str| -> Option<String> {
        Regex::new(pat)
            .unwrap()
            .captures(&entry)
            .map(|c| strip_tags(&c[1]))
    };
    let title = cap1(r"(?s)<title>(.*?)</title>");
    let summary = cap1(r"(?s)<summary>(.*?)</summary>");
    let published = cap1(r"<published>(\d{4}-\d{2}-\d{2})");
    let doi = cap1(r"(?s)<arxiv:doi[^>]*>(.*?)</arxiv:doi>");
    let author_re = Regex::new(r"(?s)<author>\s*<name>(.*?)</name>").unwrap();
    let creators: Vec<Value> = author_re
        .captures_iter(&entry)
        .map(|c| split_name(&strip_tags(&c[1])))
        .collect();

    let mut item = json!({
        "itemType": "preprint",
        "repository": "arXiv",
        "archiveID": format!("arXiv:{aid}"),
        "url": format!("https://arxiv.org/abs/{aid}"),
        "libraryCatalog": "arXiv",
    });
    set_if(&mut item, "title", title);
    set_if(&mut item, "abstractNote", summary);
    set_if(&mut item, "date", published);
    set_if(&mut item, "DOI", doi);
    if !creators.is_empty() {
        item["creators"] = Value::Array(creators);
    }
    Ok(Resolved {
        item,
        pdf_candidates: vec![format!("https://arxiv.org/pdf/{aid}")],
        landing_url: Some(format!("https://arxiv.org/abs/{aid}")),
        kind: "arxiv".into(),
    })
}

/// Extract `<meta name="..." content="...">` values, tolerating either
/// attribute order.
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

fn meta_first(html: &str, name: &str) -> Option<String> {
    meta_values(html, name).into_iter().next()
}

async fn resolve_url(app: &AppHandle, state: &AppState, url: &str) -> Result<Resolved> {
    log(app, "info", format!("Fetching page metadata from {url}"));
    state.throttle(&host_of(url)).await;
    let resp = state.http.get(url).send().await?;
    let final_url = resp.url().to_string();
    let html = resp.text().await?;

    // If the page declares a DOI, resolve through CrossRef for better data.
    if let Some(doi) = meta_first(&html, "citation_doi").or_else(|| meta_first(&html, "dc.identifier")) {
        let doi = doi.trim_start_matches("doi:").trim().to_string();
        if classify(&doi) == Some(Identifier::Doi(doi.clone())) {
            log(app, "info", format!("Page declares DOI {doi} — using CrossRef"));
            let mut resolved = resolve_doi(app, state, &doi).await?;
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
        meta_first(&html, "citation_publication_date").or_else(|| meta_first(&html, "citation_date")),
    );
    set_if(&mut item, "abstractNote", meta_first(&html, "citation_abstract").or_else(|| meta_first(&html, "description")));
    set_if(&mut item, "websiteTitle", meta_first(&html, "og:site_name"));

    let mut candidates = Vec::new();
    if let Some(pdf) = meta_first(&html, "citation_pdf_url") {
        candidates.push(pdf);
    }
    if final_url.to_ascii_lowercase().split('?').next().unwrap_or("").ends_with(".pdf") {
        candidates.push(final_url.clone());
    }
    Ok(Resolved {
        item,
        pdf_candidates: candidates,
        landing_url: Some(final_url),
        kind: "url".into(),
    })
}
