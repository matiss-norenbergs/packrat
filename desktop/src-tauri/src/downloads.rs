use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{webview::DownloadEvent, AppHandle, Emitter, Manager, Runtime, Webview};
use tauri_plugin_notification::NotificationExt;

/// Emitted when a download starts; the frontend shows a "Downloading…" toast
/// (`frontend/src/hooks/useDownloadToasts.ts`).
#[derive(Serialize, Clone, Debug, PartialEq)]
struct Started {
    filename: String,
    path: String,
}

/// Emitted when a download ends. `path` is where it was saved (absent if the webview didn't say).
#[derive(Serialize, Clone, Debug, PartialEq)]
struct Finished {
    path: Option<String>,
    success: bool,
}

impl Started {
    fn new(destination: &Path) -> Self {
        Self {
            filename: destination
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path: destination.display().to_string(),
        }
    }
}

impl Finished {
    fn new(path: Option<&Path>, success: bool) -> Self {
        Self {
            path: path.map(|p| p.display().to_string()),
            success,
        }
    }
}

/// `dir/name`, or `dir/stem (1).ext`, `dir/stem (2).ext`, … if that already exists — a download
/// never overwrites an earlier one.
fn unique_path(dir: &Path, name: &OsStr) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let name = Path::new(name);
    let stem = name
        .file_stem()
        .unwrap_or(name.as_os_str())
        .to_string_lossy();
    let ext = name
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    (1..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("an unbounded range always yields a free name")
}

/// Download handler for the main window. Backups are fetched from the server as file downloads,
/// and the webview would otherwise drop them in the process's working directory: keep only the
/// filename the server suggested and save it into the OS Downloads folder, then notify.
pub fn on_download<R: Runtime>(
    handle: AppHandle<R>,
) -> impl Fn(Webview<R>, DownloadEvent<'_>) -> bool {
    move |_webview, event| {
        match event {
            DownloadEvent::Requested { destination, .. } => {
                if let Some(name) = destination.file_name().map(|n| n.to_owned()) {
                    let dir = handle
                        .path()
                        .download_dir()
                        .or_else(|_| handle.path().home_dir())
                        .unwrap_or_else(|_| std::env::temp_dir());
                    *destination = unique_path(&dir, &name);
                }
                let _ = handle.emit("download-started", Started::new(destination));
            }
            DownloadEvent::Finished { path, success, .. } => {
                let _ = handle.emit("download-finished", Finished::new(path.as_deref(), success));
                // The in-app toast covers a focused window; the OS notification is for when the
                // window is hidden (tray), minimized or behind another app.
                let focused = handle
                    .get_webview_window("main")
                    .and_then(|w| w.is_focused().ok())
                    .unwrap_or(false);
                if let (Some(path), true, false) = (path, success, focused) {
                    let _ = handle
                        .notification()
                        .builder()
                        .title("Download complete")
                        .body(path.display().to_string())
                        .show();
                }
            }
            _ => {}
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_payloads_use_the_final_destination() {
        let started = Started::new(Path::new("/dl/backup (1).json"));
        assert_eq!(started.filename, "backup (1).json");
        assert_eq!(started.path, "/dl/backup (1).json");
        let json = serde_json::to_value(Finished::new(Some(Path::new("/dl/a")), true)).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "path": "/dl/a", "success": true })
        );
        let json = serde_json::to_value(Finished::new(None, false)).unwrap();
        assert_eq!(json, serde_json::json!({ "path": null, "success": false }));
    }

    #[test]
    fn unique_path_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("packrat-desktop-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let name = OsStr::new("backup.json");

        assert_eq!(unique_path(&dir, name), dir.join("backup.json"));
        std::fs::write(dir.join("backup.json"), "a").unwrap();
        assert_eq!(unique_path(&dir, name), dir.join("backup (1).json"));
        std::fs::write(dir.join("backup (1).json"), "b").unwrap();
        assert_eq!(unique_path(&dir, name), dir.join("backup (2).json"));
        // No extension.
        std::fs::write(dir.join("notes"), "c").unwrap();
        assert_eq!(
            unique_path(&dir, OsStr::new("notes")),
            dir.join("notes (1)")
        );

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
