use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use tauri::{webview::DownloadEvent, AppHandle, Manager, Runtime, Webview};
use tauri_plugin_notification::NotificationExt;

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
            }
            DownloadEvent::Finished {
                path: Some(path),
                success: true,
                ..
            } => {
                let _ = handle
                    .notification()
                    .builder()
                    .title("Download complete")
                    .body(path.display().to_string())
                    .show();
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
