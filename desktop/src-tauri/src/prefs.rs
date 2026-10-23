use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// Desktop-shell preferences the Rust side has to know without asking the webview — whether closing
/// the window hides it to the tray, and whether a launch from the autostart entry starts hidden.
/// Persisted as JSON in the app config directory (the webview's own `localStorage` isn't readable
/// from Rust at close or startup time).
#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(default, rename_all = "camelCase")]
struct Stored {
    close_to_tray: bool,
    start_minimized: bool,
}

impl Default for Stored {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            start_minimized: false,
        }
    }
}

pub struct Prefs {
    close_to_tray: AtomicBool,
    start_minimized: AtomicBool,
}

impl Prefs {
    pub fn close_to_tray(&self) -> bool {
        self.close_to_tray.load(Ordering::Relaxed)
    }

    pub fn start_minimized(&self) -> bool {
        self.start_minimized.load(Ordering::Relaxed)
    }

    fn snapshot(&self) -> Stored {
        Stored {
            close_to_tray: self.close_to_tray(),
            start_minimized: self.start_minimized(),
        }
    }
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("desktop.json"))
}

/// Loads the saved preferences; a missing or unreadable file means the defaults.
pub fn load(app: &AppHandle) -> Prefs {
    let stored: Stored = path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    Prefs {
        close_to_tray: AtomicBool::new(stored.close_to_tray),
        start_minimized: AtomicBool::new(stored.start_minimized),
    }
}

fn save(app: &AppHandle, stored: &Stored) -> Result<(), String> {
    let path = path(app).ok_or("no config directory")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(stored).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
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
    // Saved before the in-memory flag changes, so a failed write leaves both as they were.
    save(
        &app,
        &Stored {
            close_to_tray: enabled,
            ..prefs.snapshot()
        },
    )?;
    prefs.close_to_tray.store(enabled, Ordering::Relaxed);
    Ok(())
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
    save(
        &app,
        &Stored {
            start_minimized: enabled,
            ..prefs.snapshot()
        },
    )?;
    prefs.start_minimized.store(enabled, Ordering::Relaxed);
    Ok(())
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
