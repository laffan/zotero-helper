//! Desktop-only embedded "PDF rescue" browser: a child webview overlaid
//! on the main window, framed by the React CaptureModal (which owns the
//! chrome — header, Back / Grab / Close — and reports the body rect the
//! webview should cover). Downloads are intercepted into the app's temp
//! dir and reported via `pdf-captured`; navigation to a PDF-looking URL
//! is reported via `pdf-url-detected` so the frontend can fetch it.
//!
//! Publisher "Download PDF" buttons routinely use window.open /
//! target=_blank, which a Tauri webview swallows (popups route to the
//! opener plugin, which remote pages are rightly not allowed to call).
//! An init script rewrites those into same-webview navigation so the
//! interceptors above see them.

#[cfg(desktop)]
pub use imp::*;

#[cfg(desktop)]
mod imp {
    use crate::log;
    use serde_json::json;
    use tauri::webview::DownloadEvent;
    use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager};

    /// Rewrites popup-style link opening into same-webview navigation.
    /// Runs at document start on every page loaded in the capture view.
    const NEUTER_POPUPS: &str = r#"
(function () {
  var go = function (u) { try { if (u) window.location.href = String(u); } catch (e) {} };
  try { window.open = function (u) { go(u); return null; }; } catch (e) {}
  document.addEventListener("click", function (e) {
    var t = e.target;
    var a = t && t.closest ? t.closest("a[target]") : null;
    if (a && a.href && a.getAttribute("target") === "_blank") {
      e.preventDefault();
      go(a.href);
    }
  }, true);
})();
"#;

    fn capture_label(job_id: &str) -> String {
        let safe: String = job_id
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
            .collect();
        format!("capture-{safe}")
    }

    /// Publisher PDF endpoints rarely end in ".pdf" — cover the common
    /// shapes (ScienceDirect pdfft, Wiley pdfdirect, /doi/pdf, Springer
    /// content/pdf, trailing /pdf).
    fn looks_like_pdf_url(url: &tauri::Url) -> bool {
        let p = url.path().to_ascii_lowercase();
        p.ends_with(".pdf")
            || p.ends_with("/pdf")
            || p.contains("/pdfft")
            || p.contains("/pdfdirect")
            || p.contains("/doi/pdf")
            || p.contains("/content/pdf/")
            || url
                .query()
                .map(|q| {
                    let q = q.to_ascii_lowercase();
                    q.contains("format=pdf") || q.contains("type=pdf")
                })
                .unwrap_or(false)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn open_capture(
        app: &AppHandle,
        url: String,
        job_id: String,
        tmp_dir: std::path::PathBuf,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    ) -> crate::Result<()> {
        close_capture(app, &job_id);
        let label = capture_label(&job_id);
        let window = app
            .get_window("main")
            .ok_or_else(|| crate::Error::msg("main window not found"))?;
        let parsed: tauri::Url = url
            .parse()
            .map_err(|e| crate::Error::msg(format!("Invalid URL {url}: {e}")))?;
        std::fs::create_dir_all(&tmp_dir)?;

        let app_dl = app.clone();
        let job_dl = job_id.clone();
        let app_nav = app.clone();
        let job_nav = job_id.clone();

        let builder =
            tauri::webview::WebviewBuilder::new(&label, tauri::WebviewUrl::External(parsed))
                .initialization_script(NEUTER_POPUPS)
                .on_download(move |_webview, event| {
                    match event {
                        DownloadEvent::Requested { url, destination } => {
                            let name = crate::pdf::suggest_filename(url.as_str());
                            *destination =
                                tmp_dir.join(format!("{}-{}", crate::zotero::now_ms(), name));
                            log(&app_dl, "info", format!("Capturing download from {url}"));
                        }
                        DownloadEvent::Finished { path, success, .. } => {
                            if success {
                                if let Some(p) = path {
                                    let _ = app_dl.emit(
                                        "pdf-captured",
                                        json!({ "jobId": job_dl, "path": p.to_string_lossy() }),
                                    );
                                    log(&app_dl, "info", "Download captured — attaching to item");
                                }
                            } else {
                                log(&app_dl, "warn", "Download failed in capture view");
                            }
                        }
                        _ => {}
                    }
                    true
                })
                .on_navigation(move |nav_url| {
                    if looks_like_pdf_url(nav_url) {
                        let _ = app_nav.emit(
                            "pdf-url-detected",
                            json!({ "jobId": job_nav, "url": nav_url.to_string() }),
                        );
                    }
                    true
                });

        window.add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(w.max(50.0), h.max(50.0)),
        )?;
        log(app, "info", format!("Opened capture browser for {url}"));
        Ok(())
    }

    pub fn set_capture_bounds(app: &AppHandle, job_id: &str, x: f64, y: f64, w: f64, h: f64) {
        if let Some(webview) = app.get_webview(&capture_label(job_id)) {
            let _ = webview.set_position(LogicalPosition::new(x, y));
            let _ = webview.set_size(LogicalSize::new(w.max(50.0), h.max(50.0)));
        }
    }

    pub fn capture_back(app: &AppHandle, job_id: &str) {
        if let Some(webview) = app.get_webview(&capture_label(job_id)) {
            let _ = webview.eval("history.back()");
        }
    }

    /// Manual trigger: treat whatever page the capture view is showing as
    /// the PDF (for viewers our URL heuristics didn't recognize).
    pub fn capture_grab(app: &AppHandle, job_id: &str) -> crate::Result<()> {
        let webview = app
            .get_webview(&capture_label(job_id))
            .ok_or_else(|| crate::Error::msg("capture view is not open"))?;
        let url = webview.url()?;
        let _ = app.emit(
            "pdf-url-detected",
            json!({ "jobId": job_id, "url": url.to_string() }),
        );
        Ok(())
    }

    pub fn close_capture(app: &AppHandle, job_id: &str) {
        if let Some(webview) = app.get_webview(&capture_label(job_id)) {
            let _ = webview.close();
        }
    }
}
