//! Read-only view of a local Hush installation, so the "Send to Hush"
//! picker can offer real desks/projects. Hush's on-disk layout (see
//! Hush's README-TECHNICAL "Data Storage"):
//!
//!   {data_dir}/com.hush.app/settings.json        — desk registry [{id,name}]
//!   {data_dir}/com.hush.app/desks/<id>/.hushdesk — desk identity (fallback)
//!   {data_dir}/com.hush.app/desks/roots.json     — external desk folders
//!   <desk dir>/.hush/tree.json                   — tree; type=="project" nodes
//!
//! Everything degrades gracefully: no Hush install (or iOS sandboxing)
//! yields an empty list and the UI falls back to free-text names, which
//! Hush resolves case-insensitively on its side.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HushProject {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HushDesk {
    pub id: String,
    pub name: String,
    pub projects: Vec<HushProject>,
}

fn hush_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("com.hush.app"))
}

fn read_json(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// deskId → directory for desks living outside the internal `desks/`
/// folder ("local desks"). roots.json values are either a bare path
/// string or an object with a `path` field.
fn desk_roots(root: &Path) -> HashMap<String, PathBuf> {
    let mut out = HashMap::new();
    if let Some(v) = read_json(&root.join("desks/roots.json")) {
        if let Some(map) = v.as_object() {
            for (id, entry) in map {
                let path = entry
                    .as_str()
                    .map(String::from)
                    .or_else(|| entry["path"].as_str().map(String::from));
                if let Some(p) = path {
                    out.insert(id.clone(), PathBuf::from(p));
                }
            }
        }
    }
    out
}

fn walk_projects(node: &Value, out: &mut Vec<HushProject>) {
    // Skip trash subtrees — deleted projects shouldn't be offered.
    if let Some(id) = node["id"].as_str() {
        if id.starts_with("__trash__") {
            return;
        }
    }
    if node["type"].as_str() == Some("project") {
        if let (Some(id), Some(name)) = (node["id"].as_str(), node["name"].as_str()) {
            out.push(HushProject {
                id: id.to_string(),
                name: name.to_string(),
            });
        }
    }
    if let Some(children) = node["children"].as_array() {
        for c in children {
            walk_projects(c, out);
        }
    }
}

fn projects_of(desk_dir: &Path) -> Vec<HushProject> {
    let mut out = Vec::new();
    if let Some(tree) = read_json(&desk_dir.join(".hush/tree.json")) {
        // tree.json holds the desk's node; tolerate a legacy array form.
        match tree {
            Value::Array(nodes) => {
                for n in &nodes {
                    walk_projects(n, &mut out);
                }
            }
            node => walk_projects(&node, &mut out),
        }
    }
    out
}

pub fn list_desks() -> Vec<HushDesk> {
    let Some(root) = hush_data_dir() else {
        return Vec::new();
    };
    if !root.exists() {
        return Vec::new();
    }
    let roots = desk_roots(&root);

    // Primary source: the desk registry in settings.json (ordered).
    let mut ordered: Vec<(String, String)> = Vec::new();
    if let Some(settings) = read_json(&root.join("settings.json")) {
        if let Some(arr) = settings["desks"].as_array() {
            for d in arr {
                if let (Some(id), Some(name)) = (d["id"].as_str(), d["name"].as_str()) {
                    ordered.push((id.to_string(), name.to_string()));
                }
            }
        }
    }

    // Augment with desks present on disk but missing from the registry.
    if let Ok(entries) = std::fs::read_dir(root.join("desks")) {
        for e in entries.flatten() {
            if !e.path().is_dir() {
                continue;
            }
            if let Some(meta) = read_json(&e.path().join(".hushdesk")) {
                if let (Some(id), Some(name)) = (meta["id"].as_str(), meta["name"].as_str()) {
                    if !ordered.iter().any(|(i, _)| i == id) {
                        ordered.push((id.to_string(), name.to_string()));
                    }
                }
            }
        }
    }

    ordered
        .into_iter()
        .map(|(id, name)| {
            let dir = roots
                .get(&id)
                .cloned()
                .unwrap_or_else(|| root.join("desks").join(&id));
            HushDesk {
                projects: projects_of(&dir),
                id,
                name,
            }
        })
        .collect()
}
