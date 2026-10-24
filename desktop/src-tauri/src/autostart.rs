//! "Launch at login" (Settings → Desktop). The switch reads and writes the OS entry and keeps no copy
//! of its own. Linux and macOS go through `tauri-plugin-autostart`. Windows does not: the plugin
//! (via `auto-launch`) writes the `Run` value as `<exe> --minimized` with no quotes around the path,
//! which Windows mis-parses when the path has a space (`C:\Users\John Smith\…`), so there the value
//! is written here as `"<exe>" --minimized`, and an unquoted one left by an earlier version is
//! rewritten at startup (`repair`).

use tauri::{AppHandle, Runtime};

/// The `Run` value for `exe`: the path quoted, then the arguments.
#[cfg_attr(not(windows), allow(dead_code))]
fn run_command(exe: &str, args: &[&str]) -> String {
    let mut command = format!("\"{exe}\"");
    for arg in args {
        command.push(' ');
        command.push_str(arg);
    }
    command
}

/// Whether a `Run` value starts its program path without a quote — what older versions wrote.
#[cfg_attr(not(windows), allow(dead_code))]
fn is_unquoted(value: &str) -> bool {
    !value.trim_start().starts_with('"')
}

#[cfg(windows)]
mod platform {
    use super::*;
    use crate::prefs::MINIMIZED_ARG;
    use windows_registry::{Key, Type, CURRENT_USER};

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    /// Task Manager's Startup tab records its enable/disable choice here, per `Run` value.
    const APPROVED: &str =
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    const APPROVED_ENABLED: [u8; 12] = [0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const FILE_NOT_FOUND: i32 = 0x8007_0002_u32 as i32;

    fn not_found(error: &windows_result::Error) -> bool {
        error.code().0 == FILE_NOT_FOUND
    }

    fn name<R: Runtime>(app: &AppHandle<R>) -> String {
        app.package_info().name.clone()
    }

    fn read_run(name: &str) -> Result<Option<String>, String> {
        match CURRENT_USER.open(RUN).and_then(|k| k.get_string(name)) {
            Ok(value) => Ok(Some(value)),
            Err(e) if not_found(&e) => Ok(None),
            Err(e) => Err(e.message()),
        }
    }

    fn write_run(name: &str, command: &str) -> Result<(), String> {
        CURRENT_USER
            .create(RUN)
            .and_then(|k: Key| k.set_string(name, command))
            .map_err(|e| e.message())
    }

    /// Whether Task Manager has the entry switched on (no record means on). The last eight bytes
    /// are a timestamp that is zero for an enabled entry.
    fn approved(name: &str) -> Result<bool, String> {
        match CURRENT_USER.open(APPROVED).and_then(|k| k.get_value(name)) {
            Ok(value) => Ok(value.len() < 8 || value.iter().rev().take(8).all(|b| *b == 0)),
            Err(e) if not_found(&e) => Ok(true),
            Err(e) => Err(e.message()),
        }
    }

    /// Clears a "disabled in Task Manager" mark, as turning the switch on must.
    fn approve(name: &str) -> Result<(), String> {
        match CURRENT_USER.options().write().open(APPROVED) {
            Ok(key) => key
                .set_bytes(name, Type::Bytes, &APPROVED_ENABLED)
                .map_err(|e| e.message()),
            Err(e) if not_found(&e) => Ok(()),
            Err(e) => Err(e.message()),
        }
    }

    fn command() -> Result<String, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        Ok(run_command(&exe.display().to_string(), &[MINIMIZED_ARG]))
    }

    pub fn is_enabled<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
        let name = name(app);
        if read_run(&name)?.is_none() {
            return Ok(false);
        }
        approved(&name)
    }

    pub fn set<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
        let name = name(app);
        if enabled {
            write_run(&name, &command()?)?;
            approve(&name)
        } else {
            match CURRENT_USER
                .options()
                .write()
                .open(RUN)
                .and_then(|k| k.remove_value(&name))
            {
                Ok(()) => Ok(()),
                Err(e) if not_found(&e) => Ok(()),
                Err(e) => Err(e.message()),
            }
        }
    }

    /// Rewrites a value an earlier version left unquoted. Never turns the entry on, and leaves
    /// Task Manager's choice alone.
    pub fn repair<R: Runtime>(app: &AppHandle<R>) {
        let name = name(app);
        let result = match read_run(&name) {
            Ok(Some(value)) if is_unquoted(&value) => command().and_then(|c| write_run(&name, &c)),
            Ok(_) => Ok(()),
            Err(e) => Err(e),
        };
        if let Err(err) = result {
            eprintln!("couldn't repair the launch-at-login entry: {err}");
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    use tauri_plugin_autostart::ManagerExt;

    pub fn is_enabled<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
        app.autolaunch().is_enabled().map_err(|e| e.to_string())
    }

    pub fn set<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
        let launcher = app.autolaunch();
        if enabled {
            launcher.enable()
        } else {
            launcher.disable()
        }
        .map_err(|e| e.to_string())
    }

    pub fn repair<R: Runtime>(_app: &AppHandle<R>) {}
}

pub use platform::repair;

#[tauri::command]
pub fn autostart_is_enabled(app: AppHandle) -> Result<bool, String> {
    platform::is_enabled(&app)
}

#[tauri::command]
pub fn autostart_set(app: AppHandle, enabled: bool) -> Result<(), String> {
    platform::set(&app, enabled)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prefs::MINIMIZED_ARG;

    #[test]
    fn the_program_path_is_quoted_whether_or_not_it_has_spaces() {
        assert_eq!(
            run_command(
                r"C:\Users\John Smith\AppData\Local\Packrat\packrat-desktop.exe",
                &["--minimized"]
            ),
            r#""C:\Users\John Smith\AppData\Local\Packrat\packrat-desktop.exe" --minimized"#
        );
        assert_eq!(
            run_command(r"C:\Users\me\Packrat\packrat-desktop.exe", &["--minimized"]),
            r#""C:\Users\me\Packrat\packrat-desktop.exe" --minimized"#
        );
    }

    #[test]
    fn arguments_follow_the_quoted_path() {
        assert_eq!(run_command(r"C:\p.exe", &[]), r#""C:\p.exe""#);
        assert_eq!(
            run_command(r"C:\p.exe", &["--minimized", "--x"]),
            r#""C:\p.exe" --minimized --x"#
        );
    }

    #[test]
    fn recognises_the_unquoted_value_older_versions_wrote() {
        assert!(is_unquoted(
            r"C:\Users\me\AppData\Local\Packrat\packrat-desktop.exe --minimized"
        ));
        assert!(is_unquoted(
            r"C:\Users\John Smith\Packrat\packrat-desktop.exe --minimized"
        ));
        assert!(is_unquoted(r"C:\p.exe"));
        assert!(is_unquoted(""));
    }

    #[test]
    fn a_quoted_value_is_left_alone() {
        assert!(!is_unquoted(r#""C:\Users\John Smith\p.exe" --minimized"#));
        assert!(!is_unquoted(r#""C:\p.exe""#));
        assert!(!is_unquoted(r#"  "C:\p.exe" --minimized"#));
    }

    #[test]
    fn what_we_write_is_never_taken_for_unquoted() {
        for exe in [r"C:\a b\p.exe", r"C:\ab\p.exe"] {
            assert!(!is_unquoted(&run_command(exe, &[MINIMIZED_ARG])));
        }
    }
}
