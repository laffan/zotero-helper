//! ISBN resolution via Open Library, falling back to Google Books.

use super::{s_of, set_if, split_name, Resolved};
use crate::state::AppState;
use crate::{log, Error, Result};
use serde_json::{json, Value};
use tauri::AppHandle;

pub(super) async fn resolve_isbn(
    app: &AppHandle,
    state: &AppState,
    isbn: &str,
) -> Result<Resolved> {
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
