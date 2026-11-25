//! The PDF rescue browser's commands, the same on every platform: on
//! the desktop a child webview over the window (capture.rs), on iOS the
//! native view of tauri-plugin-capture-view.

use crate::state::AppState;
use crate::Result;
use tauri::{AppHandle, State};
#[cfg(desktop)]
use crate::capture;
#[cfg(not(desktop))]
use crate::Error;
#[cfg(not(desktop))]
use tauri::Manager;

#[cfg(not(desktop))]
fn capture_plugin(app: &AppHandle) -> State<'_, tauri_plugin_capture_view::CaptureView<tauri::Wry>> {
    app.state::<tauri_plugin_capture_view::CaptureView<tauri::Wry>>()
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn open_capture_window(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    job_id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<()> {
    #[cfg(desktop)]
    {
        let tmp = state.tmp_dir();
        capture::open_capture(&app, url, job_id, tmp, x, y, w, h)
    }
    #[cfg(not(desktop))]
    {
        let _ = state;
        capture_plugin(&app)
            .open(tauri_plugin_capture_view::OpenArgs { url, job_id, x, y, w, h })
            .map_err(Error::msg)
    }
}

#[tauri::command]
pub async fn capture_set_bounds(
    app: AppHandle,
    job_id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<()> {
    #[cfg(desktop)]
    {
        capture::set_capture_bounds(&app, &job_id, x, y, w, h);
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = job_id;
        capture_plugin(&app)
            .set_bounds(tauri_plugin_capture_view::BoundsArgs { x, y, w, h })
            .map_err(Error::msg)
    }
}

#[tauri::command]
pub async fn capture_back(app: AppHandle, job_id: String) -> Result<()> {
    #[cfg(desktop)]
    {
        capture::capture_back(&app, &job_id);
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = job_id;
        capture_plugin(&app).back().map_err(Error::msg)
    }
}

#[tauri::command]
pub async fn capture_grab(app: AppHandle, job_id: String) -> Result<()> {
    #[cfg(desktop)]
    return capture::capture_grab(&app, &job_id);
    #[cfg(not(desktop))]
    {
        let _ = job_id;
        capture_plugin(&app).grab().map_err(Error::msg)
    }
}

#[tauri::command]
pub async fn close_capture_window(app: AppHandle, job_id: String) -> Result<()> {
    #[cfg(desktop)]
    {
        capture::close_capture(&app, &job_id);
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = job_id;
        capture_plugin(&app).close().map_err(Error::msg)
    }
}
