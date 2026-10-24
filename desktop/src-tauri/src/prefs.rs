use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};

/// Desktop-shell preferences the Rust side has to know without asking the webview — whether closing
/// the window hides it to the tray, whether a launch from the autostart entry starts hidden, and
/// where downloads go. Persisted as JSON in the app config directory (the webview's own
/// `localStorage` isn't readable from Rust at close, startup or download time).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
struct Stored {
    close_to_tray: bool,
    start_minimized: bool,
    /// Show a native Save dialog for every download instead of saving straight to the folder.
    ask_where_to_save: bool,
    /// The folder downloads are saved to; `None` is the OS Downloads folder.
    download_dir: Option<PathBuf>,
    /// The folder the last Save dialog ended in; the next one starts there.
    last_save_dir: Option<PathBuf>,
}

impl Default for Stored {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            start_minimized: false,
            ask_where_to_save: false,
            download_dir: None,
            last_save_dir: None,
        }
    }
}

pub struct Prefs {
    inner: Mutex<Stored>,
}

impl Prefs {
    fn get<T>(&self, read: impl FnOnce(&Stored) -> T) -> T {
        read(&self.inner.lock().unwrap_or_else(|e| e.into_inner()))
    }

    pub fn close_to_tray(&self) -> bool {
        self.get(|s| s.close_to_tray)
    }

    pub fn start_minimized(&self) -> bool {
        self.get(|s| s.start_minimized)
    }

    pub fn ask_where_to_save(&self) -> bool {
        self.get(|s| s.ask_where_to_save)
    }

    pub fn download_dir(&self) -> Option<PathBuf> {
        self.get(|s| s.download_dir.clone())
    }

    pub fn last_save_dir(&self) -> Option<PathBuf> {
        self.get(|s| s.last_save_dir.clone())
    }

    /// Applies `change` and saves the result. The file is written before the in-memory copy
    /// changes, so a failed write leaves both as they were.
    fn update<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        change: impl FnOnce(&mut Stored),
    ) -> Result<(), String> {
        let mut current = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let mut next = current.clone();
        change(&mut next);
        save(path(app).ok_or("no config directory")?.as_path(), &next)?;
        *current = next;
        Ok(())
    }
}

fn path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("desktop.json"))
}

/// Reads the preferences file; a missing or unreadable file means the defaults.
fn read(path: &Path) -> Stored {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(path: &Path, stored: &Stored) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(stored).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

/// Loads the saved preferences.
pub fn load<R: Runtime>(app: &AppHandle<R>) -> Prefs {
    Prefs {
        inner: Mutex::new(path(app).map(|p| read(&p)).unwrap_or_default()),
    }
}

#[tauri::command]
pub fn get_close_to_tray(prefs: State<'_, Prefs>) -> bool {
    prefs.close_to_tray()
}

#[tauri::command]
pub fn set_close_to_tray(
    app: AppHandle,
    prefs: State<'_, Prefs>,
    enabled: bool,
) -> Result<(), String> {
    prefs.update(&app, |s| s.close_to_tray = enabled)
}

#[tauri::command]
pub fn get_start_minimized(prefs: State<'_, Prefs>) -> bool {
    prefs.start_minimized()
}

#[tauri::command]
pub fn set_start_minimized(
    app: AppHandle,
    prefs: State<'_, Prefs>,
    enabled: bool,
) -> Result<(), String> {
    prefs.update(&app, |s| s.start_minimized = enabled)
}

#[tauri::command]
pub fn get_ask_where_to_save(prefs: State<'_, Prefs>) -> bool {
    prefs.ask_where_to_save()
}

#[tauri::command]
pub fn set_ask_where_to_save(
    app: AppHandle,
    prefs: State<'_, Prefs>,
    enabled: bool,
) -> Result<(), String> {
    prefs.update(&app, |s| s.ask_where_to_save = enabled)
}

/// Remembers where the last Save dialog ended up (best effort — losing it only costs a folder
/// click next time).
pub fn remember_save_dir<R: Runtime>(app: &AppHandle<R>, prefs: &Prefs, dir: &Path) {
    let _ = prefs.update(app, |s| s.last_save_dir = Some(dir.to_path_buf()));
}

/// Changes the folder downloads are saved to; `None` goes back to the OS Downloads folder.
pub fn set_download_dir<R: Runtime>(
    app: &AppHandle<R>,
    prefs: &Prefs,
    dir: Option<PathBuf>,
) -> Result<(), String> {
    prefs.update(app, |s| s.download_dir = dir)
}

/// The argument the autostart entry passes (see `main.rs`).
pub const MINIMIZED_ARG: &str = "--minimized";

/// Whether a launch carrying `args` was made by the autostart entry.
pub fn launched_minimized<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().any(|a| a.as_ref() == MINIMIZED_ARG)
}

/// Whether the main window starts hidden. Only an autostart launch (`--minimized`) with the
/// "Start minimized to tray" preference on does, and only when there is a working tray to bring the
/// window back from: without one the window is shown so the app is never invisible. A manual launch
/// carries no argument and always shows the window.
pub fn start_hidden(minimized_launch: bool, start_minimized: bool, tray_available: bool) -> bool {
    minimized_launch && start_minimized && tray_available
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_close_to_tray_and_tolerates_partial_files() {
        assert!(Stored::default().close_to_tray);
        assert!(!Stored::default().start_minimized);
        let parsed: Stored = serde_json::from_str("{}").unwrap();
        assert!(parsed.close_to_tray);
        assert!(!parsed.start_minimized);
        let parsed: Stored = serde_json::from_str(r#"{"closeToTray": false}"#).unwrap();
        assert!(!parsed.close_to_tray);
        assert!(!parsed.start_minimized);
        let parsed: Stored = serde_json::from_str(r#"{"startMinimized": true}"#).unwrap();
        assert!(parsed.close_to_tray, "an older file keeps the default");
        assert!(parsed.start_minimized);
    }

    #[test]
    fn a_file_from_before_start_minimized_existed_still_loads() {
        let parsed: Stored = serde_json::from_str(r#"{"closeToTray": true}"#).unwrap();
        assert!(parsed.close_to_tray && !parsed.start_minimized);
    }

    #[test]
    fn download_settings_default_to_the_old_behavior() {
        let parsed: Stored = serde_json::from_str(r#"{"closeToTray": false}"#).unwrap();
        assert!(!parsed.ask_where_to_save, "no Save dialog unless asked for");
        assert_eq!(parsed.download_dir, None, "OS Downloads folder");
        assert_eq!(parsed.last_save_dir, None);
    }

    #[test]
    fn download_settings_persist_across_a_restart() {
        let dir = std::env::temp_dir().join(format!("packrat-prefs-test-{}", std::process::id()));
        let file = dir.join("nested").join("desktop.json");
        let stored = Stored {
            ask_where_to_save: true,
            download_dir: Some(PathBuf::from("/media/videos")),
            last_save_dir: Some(PathBuf::from("/tmp/last")),
            close_to_tray: false,
            ..Stored::default()
        };
        save(&file, &stored).unwrap();
        assert_eq!(read(&file), stored);
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(json["askWhereToSave"], true);
        assert_eq!(json["downloadDir"], "/media/videos");
        // A missing or garbled file is just the defaults.
        assert_eq!(read(&dir.join("missing.json")), Stored::default());
        std::fs::write(dir.join("bad.json"), "{not json").unwrap();
        assert_eq!(read(&dir.join("bad.json")), Stored::default());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn detects_the_autostart_argument() {
        assert!(launched_minimized(["packrat", "--minimized"]));
        assert!(!launched_minimized(["packrat"]));
        assert!(!launched_minimized([
            "packrat",
            "--minimized-ish",
            "minimized"
        ]));
        assert!(!launched_minimized(Vec::<String>::new()));
    }

    #[test]
    fn only_an_autostart_launch_with_the_pref_and_a_tray_starts_hidden() {
        assert!(start_hidden(true, true, true));
        // A manual launch always shows the window.
        assert!(!start_hidden(false, true, true));
        // The pref gates the argument.
        assert!(!start_hidden(true, false, true));
        // No tray: never leave the app invisible.
        assert!(!start_hidden(true, true, false));
        assert!(!start_hidden(false, false, false));
    }
}
