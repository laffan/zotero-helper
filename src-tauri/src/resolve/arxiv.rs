//! arXiv ID resolution via the arXiv Atom API (light regex parsing — the
//! feed format is stable and adding an XML parser isn't worth the weight).

use super::{set_if, split_name, strip_tags, Resolved};
use crate::state::AppState;
use crate::{log, Error, Result};
use regex::Regex;
use serde_json::{json, Value};
use tauri::AppHandle;

pub(super) async fn resolve_arxiv(
    app: &AppHandle,
    state: &AppState,
    aid: &str,
) -> Result<Resolved> {
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
