use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// Desktop-shell preferences the Rust side has to know without asking the webview — currently just
/// whether closing the window hides it to the tray. Persisted as JSON in the app config directory
/// (the webview's own `localStorage` isn't readable from Rust at close time).
#[derive(Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Stored {
    close_to_tray: bool,
}

impl Default for Stored {
    fn default() -> Self {
        Self {
            close_to_tray: true,
        }
    }
}

pub struct Prefs {
    close_to_tray: AtomicBool,
}

impl Prefs {
    pub fn close_to_tray(&self) -> bool {
        self.close_to_tray.load(Ordering::Relaxed)
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
    save(
        &app,
        &Stored {
            close_to_tray: enabled,
        },
    )?;
    prefs.close_to_tray.store(enabled, Ordering::Relaxed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_close_to_tray_and_tolerates_partial_files() {
        assert!(Stored::default().close_to_tray);
        let parsed: Stored = serde_json::from_str("{}").unwrap();
        assert!(parsed.close_to_tray);
        let parsed: Stored = serde_json::from_str(r#"{"closeToTray": false}"#).unwrap();
        assert!(!parsed.close_to_tray);
    }
}
