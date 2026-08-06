//! Desktop-only "PDF rescue" browser window. The user navigates the
//! publisher site; any download is intercepted into the app's temp dir and
//! reported back via the `pdf-captured` event. Navigating straight to a PDF
//! URL is reported via `pdf-url-detected` so the frontend can fetch it.

#[cfg(desktop)]
pub fn open_capture_window(
    app: &tauri::AppHandle,
    url: String,
    job_id: String,
    tmp_dir: std::path::PathBuf,
) -> crate::Result<()> {
    use crate::log;
    use serde_json::json;
    use tauri::webview::DownloadEvent;
    use tauri::{Emitter, Manager};

    let label = capture_label(&job_id);
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.close();
    }

    let parsed: tauri::Url = url
        .parse()
        .map_err(|e| crate::Error::msg(format!("Invalid URL {url}: {e}")))?;

    std::fs::create_dir_all(&tmp_dir)?;

    let app_dl = app.clone();
    let job_dl = job_id.clone();
    let label_dl = label.clone();
    let app_nav = app.clone();
    let job_nav = job_id.clone();

    tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::External(parsed))
        .title("Find the PDF — downloads are captured automatically")
        .inner_size(1050.0, 780.0)
        .on_download(move |_webview, event| {
            match event {
                DownloadEvent::Requested { url, destination } => {
                    let name = crate::pdf::suggest_filename(url.as_str());
                    let dest = tmp_dir.join(format!("{}-{}", crate::zotero::now_ms(), name));
                    *destination = dest;
                    log(&app_dl, "info", format!("Capturing download from {url}"));
                }
                DownloadEvent::Finished { path, success, .. } => {
                    if success {
                        if let Some(p) = path {
                            let _ = app_dl.emit(
                                "pdf-captured",
                                json!({
                                    "jobId": job_dl,
                                    "path": p.to_string_lossy(),
                                }),
                            );
                            log(&app_dl, "info", "Download captured — attaching to item");
                            if let Some(w) = app_dl.get_webview_window(&label_dl) {
                                let _ = w.close();
                            }
                        }
                    } else {
                        log(&app_dl, "warn", "Download failed in capture window");
                    }
                }
                _ => {}
            }
            true
        })
        .on_navigation(move |nav_url| {
            let s = nav_url.to_string();
            let is_pdf = nav_url
                .path()
                .to_ascii_lowercase()
                .ends_with(".pdf");
            if is_pdf {
                let _ = app_nav.emit(
                    "pdf-url-detected",
                    json!({ "jobId": job_nav, "url": s }),
                );
            }
            true
        })
        .build()?;

    log(app, "info", format!("Opened capture browser for {url}"));
    Ok(())
}

#[cfg(desktop)]
pub fn close_capture_window(app: &tauri::AppHandle, job_id: &str) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window(&capture_label(job_id)) {
        let _ = w.close();
    }
}

#[cfg(desktop)]
fn capture_label(job_id: &str) -> String {
    let safe: String = job_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .collect();
    format!("capture-{safe}")
}
