use std::collections::HashSet;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{webview::DownloadEvent, AppHandle, Emitter, Manager, Runtime, Webview};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;

use crate::prefs::{self, Prefs};

/// Emitted when a download starts; the frontend shows a "Downloading…" toast
/// (`frontend/src/hooks/useDownloadToasts.ts`).
#[derive(Serialize, Clone, Debug, PartialEq)]
struct Started {
    filename: String,
    path: String,
}

/// Emitted when a download ends. `path` is where it was saved (absent if the webview didn't say).
/// `id` is the `path` of the matching `download-started` event — the toast to settle — which
/// differs from `path` when the file was staged and then saved somewhere else. `cancelled` is a
/// Save dialog that was dismissed: no file, and no "failed" or "complete" message either.
#[derive(Serialize, Clone, Debug, PartialEq)]
struct Finished {
    path: Option<String>,
    id: Option<String>,
    success: bool,
    cancelled: bool,
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
            id: None,
            success,
            cancelled: false,
        }
    }

    fn for_toast(mut self, id: &Path) -> Self {
        self.id = Some(id.display().to_string());
        self
    }

    fn cancelled(id: &Path) -> Self {
        Self {
            cancelled: true,
            ..Self::new(None, false).for_toast(id)
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

/// The folder downloads go to: the chosen one while it still exists, else the OS default.
fn resolve_dir(chosen: Option<PathBuf>, default: PathBuf) -> PathBuf {
    chosen.filter(|dir| dir.is_dir()).unwrap_or(default)
}

/// Where the Save dialog opens: the folder the last one ended in, else the download folder.
fn dialog_start_dir(last: Option<PathBuf>, folder: PathBuf) -> PathBuf {
    last.filter(|dir| dir.is_dir()).unwrap_or(folder)
}

/// The OS Downloads folder (falling back to the home folder, then the temp directory).
fn default_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .download_dir()
        .or_else(|_| app.path().home_dir())
        .unwrap_or_else(|_| std::env::temp_dir())
}

/// Where downloads go right now, and whether that is the OS default (also when the chosen folder
/// has since disappeared).
pub fn folder<R: Runtime>(app: &AppHandle<R>, prefs: &Prefs) -> (PathBuf, bool) {
    let default = default_dir(app);
    let dir = resolve_dir(prefs.download_dir(), default.clone());
    let is_default = dir == default;
    (dir, is_default)
}

/// What the settings page shows for "Save to".
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    path: String,
    is_default: bool,
}

impl Folder {
    fn new(path: &Path, is_default: bool) -> Self {
        Self {
            path: path.display().to_string(),
            is_default,
        }
    }
}

#[tauri::command]
pub fn get_download_folder(app: AppHandle, prefs: tauri::State<'_, Prefs>) -> Folder {
    let (dir, is_default) = folder(&app, &prefs);
    Folder::new(&dir, is_default)
}

/// Opens the native folder picker and saves the choice; `None` if it was dismissed. `async` so the
/// dialog's blocking call runs off the main thread, which has to stay free to draw the dialog.
#[tauri::command]
pub async fn choose_download_folder(
    app: AppHandle,
    prefs: tauri::State<'_, Prefs>,
) -> Result<Option<Folder>, String> {
    let (current, _) = folder(&app, &prefs);
    let mut dialog = app.dialog().file().set_directory(current);
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let Some(picked) = dialog.blocking_pick_folder() else {
        return Ok(None);
    };
    let dir = picked.into_path().map_err(|e| e.to_string())?;
    if !dir.is_dir() {
        return Err("That isn't a folder.".into());
    }
    prefs::set_download_dir(&app, &prefs, Some(dir))?;
    let (dir, is_default) = folder(&app, &prefs);
    Ok(Some(Folder::new(&dir, is_default)))
}

/// Back to the OS Downloads folder.
#[tauri::command]
pub fn reset_download_folder(
    app: AppHandle,
    prefs: tauri::State<'_, Prefs>,
) -> Result<Folder, String> {
    prefs::set_download_dir(&app, &prefs, None)?;
    let (dir, is_default) = folder(&app, &prefs);
    Ok(Folder::new(&dir, is_default))
}

/// Downloads that are being fetched into a staging folder because the user is to be asked where
/// they go (see `on_download`).
#[derive(Default)]
pub struct Downloads {
    counter: AtomicU64,
    staged: Mutex<HashSet<PathBuf>>,
}

impl Downloads {
    /// Registers a download and returns the staging path for it. Every download gets a folder of
    /// its own, so two files with the same name never collide.
    fn stage(&self, root: &Path, name: &OsStr) -> PathBuf {
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        let path = root.join(n.to_string()).join(name);
        self.staged
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(path.clone());
        path
    }

    /// Whether `path` was staged (and forgets it). The webview may report the same file spelled
    /// differently from the destination it was given (Windows prefixes, symlinked temp folders),
    /// so a path that doesn't match as is is compared in canonical form.
    fn take(&self, path: &Path) -> bool {
        let mut staged = self.staged.lock().unwrap_or_else(|e| e.into_inner());
        if staged.remove(path) {
            return true;
        }
        let Ok(wanted) = path.canonicalize() else {
            return false;
        };
        let found = staged
            .iter()
            .find(|p| p.canonicalize().is_ok_and(|c| c == wanted))
            .cloned();
        found.is_some_and(|p| staged.remove(&p))
    }
}

/// Where staged downloads live: a folder of the app's cache directory, emptied at startup.
fn staging_root<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("packrat"))
        .join("downloads")
}

/// Removes whatever an earlier run left staged (a crash or quit mid-download or mid-dialog).
pub fn clear_staging<R: Runtime>(app: &AppHandle<R>) {
    let _ = std::fs::remove_dir_all(staging_root(app));
}

/// Removes a staged file and the folder made for it.
fn discard_staged(staged: &Path) {
    let _ = std::fs::remove_file(staged);
    if let Some(dir) = staged.parent() {
        let _ = std::fs::remove_dir(dir);
    }
}

/// Moves `from` to `to`, replacing a file already there (the Save dialog has already asked about
/// that). Falls back to copy-and-delete when the two are on different drives.
fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to)?;
    std::fs::remove_file(from)
}

#[derive(Debug, PartialEq)]
enum Outcome {
    Saved(PathBuf),
    Failed,
    Cancelled,
}

/// Settles a staged download once the Save dialog has answered: `chosen` is where the user wants
/// it, `None` if they dismissed the dialog. Either way nothing is left in the staging folder.
fn settle(staged: &Path, chosen: Option<PathBuf>) -> Outcome {
    let outcome = match chosen {
        None => Outcome::Cancelled,
        Some(dest) => match move_file(staged, &dest) {
            Ok(()) => Outcome::Saved(dest),
            Err(_) => Outcome::Failed,
        },
    };
    discard_staged(staged);
    outcome
}

/// An OS notification, for when the window is hidden (tray), minimized or behind another app — the
/// in-app toast covers a focused window.
fn notify_complete<R: Runtime>(handle: &AppHandle<R>, path: &Path) {
    let focused = handle
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);
    if !focused {
        let _ = handle
            .notification()
            .builder()
            .title("Download complete")
            .body(path.display().to_string())
            .show();
    }
}

/// A staged download has finished fetching: ask where to put it. The dialog is shown without
/// blocking — the download callback runs on the webview's thread, which the dialog itself needs —
/// and its answer is handled when it comes.
fn ask_where_to_save<R: Runtime>(handle: &AppHandle<R>, staged: PathBuf) {
    let prefs = handle.state::<Prefs>();
    let (download_dir, _) = folder(handle, &prefs);
    let start = dialog_start_dir(prefs.last_save_dir(), download_dir);
    let mut dialog = handle.dialog().file().set_directory(start);
    if let Some(name) = staged.file_name() {
        dialog = dialog.set_file_name(name.to_string_lossy());
    }
    if let Some(window) = handle.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let handle = handle.clone();
    dialog.save_file(move |picked| {
        let chosen = picked.and_then(|p| p.into_path().ok());
        // The move can be a long copy across drives: keep it off the dialog's thread.
        std::thread::spawn(move || {
            let id = staged.clone();
            match settle(&staged, chosen) {
                Outcome::Saved(dest) => {
                    if let Some(dir) = dest.parent() {
                        prefs::remember_save_dir(&handle, &handle.state::<Prefs>(), dir);
                    }
                    let _ = handle.emit(
                        "download-finished",
                        Finished::new(Some(&dest), true).for_toast(&id),
                    );
                    notify_complete(&handle, &dest);
                }
                Outcome::Failed => {
                    let _ = handle.emit(
                        "download-finished",
                        Finished::new(None, false).for_toast(&id),
                    );
                }
                Outcome::Cancelled => {
                    let _ = handle.emit("download-finished", Finished::cancelled(&id));
                }
            }
        });
    });
}

/// Download handler for the main window. Backups are fetched from the server as file downloads,
/// and the webview would otherwise drop them in the process's working directory: keep only the
/// filename the server suggested.
///
/// By default the file is saved straight into the download folder (the OS Downloads folder unless
/// one was chosen in Settings → Desktop, never overwriting an existing file) and a notification is
/// raised. With "Ask where to save each download" on, it is fetched into a staging folder first
/// and the native Save dialog opens when it's complete — the destination has to be named inside
/// this callback, which can't wait for a dialog, and a `blob:` download can't be re-requested
/// anyway. Dismissing the dialog discards the staged file.
pub fn on_download<R: Runtime>(
    handle: AppHandle<R>,
) -> impl Fn(Webview<R>, DownloadEvent<'_>) -> bool {
    move |_webview, event| {
        match event {
            DownloadEvent::Requested { destination, .. } => {
                if let Some(name) = destination.file_name().map(|n| n.to_owned()) {
                    let prefs = handle.state::<Prefs>();
                    *destination = if prefs.ask_where_to_save() {
                        let staged = handle
                            .state::<Downloads>()
                            .stage(&staging_root(&handle), &name);
                        if let Some(dir) = staged.parent() {
                            let _ = std::fs::create_dir_all(dir);
                        }
                        staged
                    } else {
                        let (dir, _) = folder(&handle, &prefs);
                        unique_path(&dir, &name)
                    };
                }
                let _ = handle.emit("download-started", Started::new(destination));
            }
            DownloadEvent::Finished { path, success, .. } => {
                let staged = path
                    .as_deref()
                    .filter(|p| handle.state::<Downloads>().take(p));
                if let Some(staged) = staged {
                    if success {
                        ask_where_to_save(&handle, staged.to_path_buf());
                    } else {
                        discard_staged(staged);
                        let _ = handle.emit(
                            "download-finished",
                            Finished::new(None, false).for_toast(staged),
                        );
                    }
                } else {
                    let _ =
                        handle.emit("download-finished", Finished::new(path.as_deref(), success));
                    if let (Some(path), true) = (path, success) {
                        notify_complete(&handle, &path);
                    }
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

    fn scratch(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("packrat-desktop-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn event_payloads_use_the_final_destination() {
        let started = Started::new(Path::new("/dl/backup (1).json"));
        assert_eq!(started.filename, "backup (1).json");
        assert_eq!(started.path, "/dl/backup (1).json");
        let json = serde_json::to_value(Finished::new(Some(Path::new("/dl/a")), true)).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "path": "/dl/a", "id": null, "success": true, "cancelled": false })
        );
        let json = serde_json::to_value(Finished::new(None, false)).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "path": null, "id": null, "success": false, "cancelled": false })
        );
    }

    #[test]
    fn a_saved_staged_download_names_its_toast() {
        let json = serde_json::to_value(
            Finished::new(Some(Path::new("/home/me/b.json")), true)
                .for_toast(Path::new("/cache/downloads/0/b.json")),
        )
        .unwrap();
        assert_eq!(json["path"], "/home/me/b.json");
        assert_eq!(json["id"], "/cache/downloads/0/b.json");
        let json =
            serde_json::to_value(Finished::cancelled(Path::new("/cache/downloads/0/b.json")))
                .unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "path": null, "id": "/cache/downloads/0/b.json", "success": false, "cancelled": true
            })
        );
    }

    #[test]
    fn unique_path_never_overwrites() {
        let dir = scratch("unique");
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

    #[test]
    fn the_chosen_folder_is_used_only_while_it_exists() {
        let dir = scratch("resolve");
        let default = PathBuf::from("/os/downloads");
        assert_eq!(resolve_dir(None, default.clone()), default);
        assert_eq!(resolve_dir(Some(dir.clone()), default.clone()), dir);
        assert_eq!(
            resolve_dir(Some(dir.join("gone")), default.clone()),
            default
        );
        // A file isn't a folder.
        std::fs::write(dir.join("f"), "x").unwrap();
        assert_eq!(resolve_dir(Some(dir.join("f")), default.clone()), default);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_save_dialog_starts_where_the_last_one_ended() {
        let last = scratch("last");
        let folder = PathBuf::from("/os/downloads");
        assert_eq!(dialog_start_dir(None, folder.clone()), folder);
        assert_eq!(dialog_start_dir(Some(last.clone()), folder.clone()), last);
        // The remembered folder was deleted since.
        assert_eq!(
            dialog_start_dir(Some(last.join("gone")), folder.clone()),
            folder
        );
        std::fs::remove_dir_all(&last).unwrap();
    }

    #[test]
    fn staged_downloads_get_a_folder_each_and_are_tracked() {
        let downloads = Downloads::default();
        let root = Path::new("/cache/downloads");
        let a = downloads.stage(root, OsStr::new("backup.json"));
        let b = downloads.stage(root, OsStr::new("backup.json"));
        assert_ne!(a, b, "same name, different folders");
        assert_eq!(a.file_name(), Some(OsStr::new("backup.json")));
        assert!(a.starts_with(root));
        assert!(downloads.take(&a));
        assert!(!downloads.take(&a), "only the first take counts");
        assert!(!downloads.take(Path::new("/dl/other.json")));
        assert!(downloads.take(&b));
    }

    fn staged_file(tag: &str, content: &str) -> (PathBuf, PathBuf) {
        let root = scratch(tag);
        let staged = root.join("cache").join("0").join("b.json");
        std::fs::create_dir_all(staged.parent().unwrap()).unwrap();
        std::fs::write(&staged, content).unwrap();
        (root, staged)
    }

    #[test]
    fn saving_moves_the_file_and_cleans_up_the_staging_folder() {
        let (root, staged) = staged_file("save", "data");
        let dest = root.join("chosen.json");
        assert_eq!(
            settle(&staged, Some(dest.clone())),
            Outcome::Saved(dest.clone())
        );
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "data");
        assert!(!staged.exists());
        assert!(!staged.parent().unwrap().exists(), "no leftover folder");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn saving_over_an_existing_file_replaces_it() {
        let (root, staged) = staged_file("replace", "new");
        let dest = root.join("chosen.json");
        std::fs::write(&dest, "old").unwrap();
        assert_eq!(
            settle(&staged, Some(dest.clone())),
            Outcome::Saved(dest.clone())
        );
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "new");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn cancelling_leaves_no_file_behind() {
        let (root, staged) = staged_file("cancel", "data");
        assert_eq!(settle(&staged, None), Outcome::Cancelled);
        assert!(!staged.exists());
        assert!(!staged.parent().unwrap().exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn an_unwritable_destination_fails_and_still_cleans_up() {
        let (root, staged) = staged_file("fail", "data");
        let dest = root.join("no-such-folder").join("x.json");
        assert_eq!(settle(&staged, Some(dest.clone())), Outcome::Failed);
        assert!(!dest.exists());
        assert!(!staged.exists());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
