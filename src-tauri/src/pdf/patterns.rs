//! Learned patterns for *where a given source keeps its PDFs*.
//!
//! Publishers are consistent with themselves: once a PDF has been
//! fetched from `tandfonline.com/doi/pdf/10.1080/…`, the next paper from
//! the same imprint sits at the same shape of URL. That matters most
//! after a robot check, where the user had to walk one item through the
//! capture browser by hand — the URL that finally worked is exactly the
//! knowledge the *other* items from that source are missing.
//!
//! So every successful download is turned into a reusable pattern, keyed
//! on the publisher (the DOI registrant prefix) and on the landing host:
//!
//!   * a **template** — the PDF URL with the DOI blanked out, e.g.
//!     `https://www.tandfonline.com/doi/pdf/{doi}`;
//!   * a **rewrite** — the substring that turned the landing URL into the
//!     PDF URL, e.g. `full` → `pdf`, which covers sources whose PDF URL
//!     carries no DOI at all.
//!
//! Applying one is a speculative request at a site that has already shown
//! it watches for robots, so it is deliberately unhurried: at least
//! [`MIN_GAP_MS`] between two speculative attempts at the same host, and
//! a [`COOLDOWN_MS`] pause after [`MAX_FAILS`] of them fail in a row.
//! Patterns that keep missing are dropped — publishers move things.

use crate::state::host_of;
use crate::zotero::now_ms;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Minimum spacing between two speculative attempts at one host.
const MIN_GAP_MS: u64 = 20_000;
/// Consecutive speculative failures at a host before backing off.
const MAX_FAILS: u32 = 3;
/// How long that back-off lasts.
const COOLDOWN_MS: u64 = 15 * 60 * 1000;
/// Failures before a pattern itself is considered stale and dropped.
/// Deliberately more forgiving than [`MAX_FAILS`]: early failures are
/// usually the site refusing us rather than the URL shape being wrong,
/// and backing off is the answer to that — forgetting the pattern is
/// the answer only once it keeps missing across a back-off.
const MAX_MISSES: u32 = 5;
/// Most candidates one item is worth speculating with.
const MAX_SUGGESTIONS: usize = 3;
/// Ceiling on the whole book, oldest-used trimmed first.
const MAX_PATTERNS: usize = 300;

const PH_DOI: &str = "{doi}";
const PH_DOI_ENC: &str = "{doiEnc}";
const PH_DOI_SLASH: &str = "{doiSlashEnc}";
const PH_SUFFIX: &str = "{doiSuffix}";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PdfPattern {
    /// Host of the landing page this was learned from.
    pub host: String,
    /// DOI registrant prefix ("10.1080") — the publisher's identity, and
    /// steadier than the host, which imprints change.
    pub doi_prefix: String,
    /// PDF URL with the DOI replaced by placeholders. Empty when the URL
    /// carried no trace of the DOI.
    pub template: String,
    /// Landing → PDF substring rewrite. Empty when the two URLs were not
    /// a simple substitution apart.
    pub rewrite_from: String,
    pub rewrite_to: String,
    /// Times a suggestion from this pattern actually produced a PDF.
    pub hits: u32,
    /// Failures since the last hit.
    pub misses: u32,
    pub learned_ms: u64,
    pub last_used_ms: u64,
}

impl PdfPattern {
    /// Stable identity: what makes two learnings "the same pattern".
    fn id(&self) -> String {
        format!(
            "{}|{}|{}|{}>{}",
            self.host, self.doi_prefix, self.template, self.rewrite_from, self.rewrite_to
        )
    }

    /// One-line description for the activity log.
    pub fn describe(&self) -> String {
        if !self.template.is_empty() {
            self.template.clone()
        } else {
            format!("{} → {}", self.rewrite_from, self.rewrite_to)
        }
    }
}

/// What [`PatternBook::suggest`] decided for one item.
#[derive(Debug, Default)]
pub struct Suggestion {
    pub urls: Vec<String>,
    /// Set when a matching pattern existed but is being held back.
    pub held: Option<String>,
}

/// Per-host state for the speculative attempts. Not persisted: a back-off
/// is about this session's conversation with the site.
#[derive(Debug, Default, Clone)]
struct HostState {
    /// When the next speculative attempt may happen (already includes any
    /// pause a previous caller was told to take).
    next_ok_ms: u64,
    fails: u32,
    cooldown_until_ms: u64,
}

#[derive(Debug, Default)]
pub struct PatternBook {
    path: PathBuf,
    patterns: Vec<PdfPattern>,
    /// URLs handed out as suggestions, mapped to the pattern that made
    /// them, so the download's outcome can be credited back.
    pending: HashMap<String, String>,
    hosts: HashMap<String, HostState>,
}

fn book_path(data_dir: &Path) -> PathBuf {
    data_dir.join("pdf-patterns.json")
}

/// DOI without its `https://doi.org/` / `doi:` dressing, lowercased —
/// DOIs are case-insensitive and publishers are inconsistent about it.
fn norm_doi(doi: &str) -> String {
    let d = doi.trim();
    let d = d
        .trim_start_matches("https://doi.org/")
        .trim_start_matches("http://doi.org/")
        .trim_start_matches("https://dx.doi.org/")
        .trim_start_matches("http://dx.doi.org/");
    let d = d.trim_start_matches("doi:").trim();
    d.to_ascii_lowercase()
}

pub fn doi_prefix(doi: &str) -> String {
    norm_doi(doi)
        .split('/')
        .next()
        .unwrap_or_default()
        .to_string()
}

fn doi_suffix(doi: &str) -> String {
    norm_doi(doi)
        .split_once('/')
        .map(|(_, s)| s.to_string())
        .unwrap_or_default()
}

fn enc_all(doi: &str) -> String {
    utf8_percent_encode(doi, NON_ALPHANUMERIC).to_string()
}

fn enc_slash(doi: &str) -> String {
    doi.replace('/', "%2F")
}

/// Case-insensitive single replacement of every occurrence of `needle`.
fn replace_ci(haystack: &str, needle: &str, with: &str) -> (String, bool) {
    if needle.is_empty() {
        return (haystack.to_string(), false);
    }
    let hay_lower = haystack.to_ascii_lowercase();
    let needle_lower = needle.to_ascii_lowercase();
    let mut out = String::with_capacity(haystack.len());
    let mut at = 0;
    let mut found = false;
    while let Some(rel) = hay_lower[at..].find(&needle_lower) {
        let start = at + rel;
        out.push_str(&haystack[at..start]);
        out.push_str(with);
        at = start + needle.len();
        found = true;
    }
    out.push_str(&haystack[at..]);
    (out, found)
}

/// Turn a PDF URL into a template by blanking out the DOI in whichever
/// form the publisher wrote it.
fn template_from(pdf_url: &str, doi: &str) -> String {
    let doi = norm_doi(doi);
    if doi.is_empty() {
        return String::new();
    }
    // Most-encoded form first: a raw-DOI match inside an encoded one
    // would leave the template unusable.
    for (needle, placeholder) in [
        (enc_all(&doi), PH_DOI_ENC),
        (enc_slash(&doi), PH_DOI_SLASH),
        (doi.clone(), PH_DOI),
    ] {
        let (out, found) = replace_ci(pdf_url, &needle, placeholder);
        if found {
            return out;
        }
    }
    // Some publishers use only the part after the slash as their own id.
    let suffix = doi_suffix(&doi);
    if suffix.len() >= 4 {
        let (out, found) = replace_ci(pdf_url, &suffix, PH_SUFFIX);
        if found {
            return out;
        }
    }
    String::new()
}

/// Fill a template in for another DOI. `None` when a placeholder is left
/// over, which would only produce a nonsense request.
fn render(template: &str, doi: &str) -> Option<String> {
    let doi = norm_doi(doi);
    if doi.is_empty() || template.is_empty() {
        return None;
    }
    let out = template
        .replace(PH_DOI_ENC, &enc_all(&doi))
        .replace(PH_DOI_SLASH, &enc_slash(&doi))
        .replace(PH_SUFFIX, &doi_suffix(&doi))
        .replace(PH_DOI, &doi);
    if out.contains('{') {
        return None;
    }
    Some(out)
}

/// The substring substitution that turned the landing URL into the PDF
/// URL — the diff between them, once their common head and tail are set
/// aside. Only worth keeping when it is short enough to be a *shape*
/// ("full" → "pdf") rather than the article's own identity.
fn rewrite_from(landing: &str, pdf_url: &str, doi: &str) -> (String, String) {
    let none = (String::new(), String::new());
    if landing == pdf_url || host_of(landing) != host_of(pdf_url) {
        return none;
    }
    let l: Vec<char> = landing.chars().collect();
    let p: Vec<char> = pdf_url.chars().collect();
    let mut head = 0;
    while head < l.len() && head < p.len() && l[head] == p[head] {
        head += 1;
    }
    let mut tail = 0;
    while tail < l.len() - head && tail < p.len() - head
        && l[l.len() - 1 - tail] == p[p.len() - 1 - tail]
    {
        tail += 1;
    }
    let from: String = l[head..l.len() - tail].iter().collect();
    let to: String = p[head..p.len() - tail].iter().collect();
    // An empty `from` would match anywhere; an over-long one is this
    // article, not this publisher.
    if from.len() < 3 || from.len() > 40 || to.len() > 60 {
        return none;
    }
    let d = norm_doi(doi);
    if !d.is_empty() && from.to_ascii_lowercase().contains(&d) {
        return none;
    }
    (from, to)
}

impl PatternBook {
    pub fn load(data_dir: &Path) -> Self {
        let path = book_path(data_dir);
        let patterns = std::fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str::<Vec<PdfPattern>>(&t).ok())
            .unwrap_or_default();
        PatternBook {
            path,
            patterns,
            ..Default::default()
        }
    }

    fn persist(&mut self) {
        if self.patterns.len() > MAX_PATTERNS {
            self.patterns
                .sort_by_key(|p| std::cmp::Reverse(p.last_used_ms.max(p.learned_ms)));
            self.patterns.truncate(MAX_PATTERNS);
        }
        if self.path.as_os_str().is_empty() {
            return;
        }
        if let Ok(text) = serde_json::to_string(&self.patterns) {
            let _ = std::fs::write(&self.path, text);
        }
    }

    /// Record where a PDF that *worked* actually lived. Returns the
    /// pattern when this taught us something reusable.
    pub fn learn(
        &mut self,
        landing: Option<&str>,
        doi: Option<&str>,
        pdf_url: &str,
    ) -> Option<PdfPattern> {
        let doi = doi.map(norm_doi).unwrap_or_default();
        let landing = landing.unwrap_or_default();
        // The landing host is what a later item will be matched on; fall
        // back to the PDF's own host for items that had only a DOI.
        let host = if landing.is_empty() {
            host_of(pdf_url)
        } else {
            host_of(landing)
        };
        let template = template_from(pdf_url, &doi);
        let (rewrite_from_s, rewrite_to_s) = if landing.is_empty() {
            (String::new(), String::new())
        } else {
            rewrite_from(landing, pdf_url, &doi)
        };
        if template.is_empty() && rewrite_from_s.is_empty() {
            return None;
        }
        let now = now_ms();
        let fresh = PdfPattern {
            host,
            doi_prefix: doi_prefix(&doi),
            template,
            rewrite_from: rewrite_from_s,
            rewrite_to: rewrite_to_s,
            hits: 0,
            misses: 0,
            learned_ms: now,
            last_used_ms: now,
        };
        let id = fresh.id();
        if let Some(existing) = self.patterns.iter_mut().find(|p| p.id() == id) {
            // Already known — the credit for it is `note`'s job; this
            // just says it is still good.
            existing.misses = 0;
            existing.last_used_ms = now;
            let known = existing.clone();
            self.persist();
            return Some(known);
        }
        self.patterns.push(fresh.clone());
        self.persist();
        Some(fresh)
    }

    /// Candidate URLs for an item, from what other items of the same
    /// source taught us. Offering one costs nothing — the politeness is
    /// charged in [`PatternBook::claim`], when one is actually tried.
    pub fn suggest(&mut self, doi: Option<&str>, landing: Option<&str>) -> Suggestion {
        let doi = doi.map(norm_doi).unwrap_or_default();
        let prefix = doi_prefix(&doi);
        let landing = landing.unwrap_or_default();
        let host = if landing.is_empty() {
            String::new()
        } else {
            host_of(landing)
        };

        // Best-proven patterns first.
        let mut ranked: Vec<&PdfPattern> = self
            .patterns
            .iter()
            .filter(|p| {
                (!prefix.is_empty() && p.doi_prefix == prefix)
                    || (!host.is_empty() && p.host == host)
            })
            .collect();
        ranked.sort_by_key(|p| std::cmp::Reverse((p.hits, p.last_used_ms)));

        let mut out: Vec<(String, String)> = Vec::new();
        for p in ranked {
            if !doi.is_empty() {
                if let Some(url) = render(&p.template, &doi) {
                    if !out.iter().any(|(u, _)| u == &url) {
                        out.push((url, p.id()));
                    }
                }
            }
            // A rewrite is a statement about this host's URL layout, so
            // it only applies to a landing page on that same host.
            if !p.rewrite_from.is_empty() && p.host == host && landing.contains(&p.rewrite_from) {
                let url = landing.replace(&p.rewrite_from, &p.rewrite_to);
                if url != landing && !out.iter().any(|(u, _)| u == &url) {
                    out.push((url, p.id()));
                }
            }
            if out.len() >= MAX_SUGGESTIONS {
                break;
            }
        }
        out.truncate(MAX_SUGGESTIONS);
        if out.is_empty() {
            return Suggestion::default();
        }

        // A host that has just refused us three times is not offered
        // again until it has had its quiet quarter of an hour.
        let now = now_ms();
        let target = host_of(&out[0].0);
        let state = self.hosts.entry(target.clone()).or_default();
        if now < state.cooldown_until_ms {
            let secs = (state.cooldown_until_ms - now) / 1000;
            return Suggestion {
                held: Some(format!(
                    "{target} refused the last {MAX_FAILS} tries — holding off for another {secs}s"
                )),
                ..Default::default()
            };
        }

        if self.pending.len() > 64 {
            self.pending.clear();
        }
        for (url, id) in &out {
            self.pending.insert(url.clone(), id.clone());
        }
        Suggestion {
            urls: out.into_iter().map(|(u, _)| u).collect(),
            held: None,
        }
    }

    /// Politeness owed before firing `url`: how long the caller must wait
    /// first. Zero for any URL this book didn't suggest — an ordinary
    /// candidate is not a speculative request. `Err` when the host is
    /// mid-back-off and the attempt should be dropped altogether.
    ///
    /// Charging here rather than at suggestion time means the pause is
    /// paid only when a learned URL is really tried: an item whose
    /// open-access copy downloads first never waits at all.
    pub fn claim(&mut self, url: &str) -> std::result::Result<u64, String> {
        if !self.pending.contains_key(url) {
            return Ok(0);
        }
        let now = now_ms();
        let host = host_of(url);
        let state = self.hosts.entry(host.clone()).or_default();
        if now < state.cooldown_until_ms {
            let secs = (state.cooldown_until_ms - now) / 1000;
            self.pending.remove(url);
            return Err(format!(
                "Not trying {host} again yet — it refused the last {MAX_FAILS} attempts, waiting another {secs}s"
            ));
        }
        let wait = state.next_ok_ms.saturating_sub(now);
        // Claim the slot now, so a second item can't slip in beside this one.
        state.next_ok_ms = now + wait + MIN_GAP_MS;
        Ok(wait)
    }

    /// Credit or blame a download whose URL we suggested. Downloads we
    /// had nothing to do with are ignored.
    pub fn note(&mut self, url: &str, ok: bool) {
        let Some(id) = self.pending.remove(url) else {
            return;
        };
        let now = now_ms();
        let state = self.hosts.entry(host_of(url)).or_default();
        if ok {
            state.fails = 0;
        } else {
            state.fails += 1;
            if state.fails >= MAX_FAILS {
                state.fails = 0;
                state.cooldown_until_ms = now + COOLDOWN_MS;
            }
        }
        if let Some(p) = self.patterns.iter_mut().find(|p| p.id() == id) {
            if ok {
                p.hits += 1;
                p.misses = 0;
                p.last_used_ms = now;
            } else {
                p.misses += 1;
            }
        }
        // A pattern that keeps missing is describing a page that moved.
        self.patterns.retain(|p| p.misses < MAX_MISSES);
        self.persist();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn learns_and_applies_a_doi_template() {
        let mut book = PatternBook::default();
        let learned = book.learn(
            Some("https://www.tandfonline.com/doi/full/10.1080/01234.2020.1"),
            Some("10.1080/01234.2020.1"),
            "https://www.tandfonline.com/doi/pdf/10.1080/01234.2020.1",
        );
        assert_eq!(
            learned.unwrap().template,
            "https://www.tandfonline.com/doi/pdf/{doi}"
        );
        let s = book.suggest(Some("10.1080/98765.2021.7"), None);
        assert_eq!(
            s.urls,
            vec!["https://www.tandfonline.com/doi/pdf/10.1080/98765.2021.7"]
        );
    }

    #[test]
    fn learns_a_landing_rewrite_when_the_pdf_url_hides_the_doi() {
        let mut book = PatternBook::default();
        book.learn(
            Some("https://example.org/articles/7781/view"),
            None,
            "https://example.org/articles/7781/download",
        )
        .expect("a rewrite");
        let s = book.suggest(None, Some("https://example.org/articles/9002/view"));
        assert_eq!(s.urls, vec!["https://example.org/articles/9002/download"]);
    }

    #[test]
    fn ignores_a_pdf_url_that_teaches_nothing() {
        let mut book = PatternBook::default();
        assert!(book
            .learn(
                Some("https://doi.org/10.1/abc"),
                Some("10.1/abc"),
                "https://cdn.example.net/files/8f2a91c0.pdf",
            )
            .is_none());
    }

    #[test]
    fn spaces_out_repeat_attempts_at_one_host() {
        let mut book = PatternBook::default();
        book.learn(
            Some("https://www.tandfonline.com/doi/full/10.1080/a"),
            Some("10.1080/a"),
            "https://www.tandfonline.com/doi/pdf/10.1080/a",
        );
        let first = book.suggest(Some("10.1080/b"), None).urls.remove(0);
        assert_eq!(book.claim(&first), Ok(0));
        let second = book.suggest(Some("10.1080/c"), None).urls.remove(0);
        let wait = book.claim(&second).expect("not in back-off");
        assert!(wait > 0 && wait <= MIN_GAP_MS);
    }

    #[test]
    fn an_ordinary_candidate_never_waits() {
        let mut book = PatternBook::default();
        assert_eq!(book.claim("https://example.org/free/paper.pdf"), Ok(0));
    }

    #[test]
    fn backs_off_after_repeated_refusals() {
        let mut book = PatternBook::default();
        book.learn(
            Some("https://www.tandfonline.com/doi/full/10.1080/a"),
            Some("10.1080/a"),
            "https://www.tandfonline.com/doi/pdf/10.1080/a",
        );
        for n in 0..MAX_FAILS {
            let s = book.suggest(Some(&format!("10.1080/x{n}")), None);
            assert_eq!(s.urls.len(), 1, "expected a suggestion on try {n}");
            book.note(&s.urls[0], false);
        }
        let held = book.suggest(Some("10.1080/last"), None);
        assert!(held.urls.is_empty());
        assert!(held.held.is_some());
    }

    #[test]
    fn drops_a_pattern_that_stops_working() {
        let mut book = PatternBook::default();
        book.learn(
            Some("https://www.tandfonline.com/doi/full/10.1080/a"),
            Some("10.1080/a"),
            "https://www.tandfonline.com/doi/pdf/10.1080/a",
        );
        for n in 0..MAX_MISSES {
            let s = book.suggest(Some(&format!("10.1080/y{n}")), None);
            if let Some(url) = s.urls.first() {
                book.note(url, false);
            }
            // The host back-off is separate; clear it so the pattern
            // itself is what's under test.
            book.hosts.clear();
        }
        assert!(book.patterns.is_empty());
    }
}
