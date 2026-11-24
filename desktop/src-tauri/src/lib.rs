//! The Packrat shell: the desktop app (src/main.rs calls `run`) and, experimentally, the Android
//! app (which loads this crate as a shared library through the mobile entry point).
//!
//! Everything desktop-only — the tray, single instance, autostart, the updater, saved window
//! state, downloads and the shell preferences behind them, and the OS keychain — is compiled only
//! under `cfg(desktop)`. Mobile builds get the shared plugins (dialog, notification, opener,
//! process), the session-token commands (backed by a file in the app's private storage, see
//! token.rs) and one full-screen window.

#[cfg(desktop)]
mod autostart;
#[cfg(desktop)]
mod downloads;
#[cfg(desktop)]
mod match_update;
#[cfg(desktop)]
mod prefs;
mod token;
#[cfg(desktop)]
mod tray;

#[cfg(desktop)]
use tauri::WindowEvent;
use tauri::{Manager, WebviewWindowBuilder};
#[cfg(all(desktop, not(windows)))]
use tauri_plugin_autostart::MacosLauncher;
#[cfg(desktop)]
use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Must be registered first: a second launch hands over to the running instance, which
    // brings its window forward, instead of opening another copy.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        // An autostart entry firing while the app already runs must not pop the window up.
        if !prefs::launched_minimized(&args) {
            tray::show_main_window(app);
        }
    }));
    // The "Launch at login" switch (Settings → Desktop) goes through `autostart.rs`; the plugin's
    // entry passes an argument so the app can tell an autostart launch from a manual one. Windows
    // writes its own, correctly quoted `Run` value instead of the plugin's.
    #[cfg(all(desktop, not(windows)))]
    let builder = builder.plugin(tauri_plugin_autostart::init(
        MacosLauncher::LaunchAgent,
        Some(vec![prefs::MINIMIZED_ARG]),
    ));
    let builder = builder
        // Only the Rust side opens dialogs (downloads.rs); the webview is granted none of its commands.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init());
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init());
    // Size and position only, never visibility: the plugin would otherwise show the window again
    // right after it was created hidden for a "start minimized" launch.
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::default()
            .with_state_flags(StateFlags::all() - StateFlags::VISIBLE)
            .build(),
    );
    let builder = builder.invoke_handler(tauri::generate_handler![
        #[cfg(desktop)]
        autostart::autostart_is_enabled,
        #[cfg(desktop)]
        autostart::autostart_set,
        #[cfg(desktop)]
        match_update::match_update_check,
        #[cfg(desktop)]
        match_update::match_update_install,
        #[cfg(desktop)]
        prefs::get_close_to_tray,
        #[cfg(desktop)]
        prefs::set_close_to_tray,
        #[cfg(desktop)]
        prefs::get_start_minimized,
        #[cfg(desktop)]
        prefs::set_start_minimized,
        #[cfg(desktop)]
        prefs::get_ask_where_to_save,
        #[cfg(desktop)]
        prefs::set_ask_where_to_save,
        #[cfg(desktop)]
        downloads::get_download_folder,
        #[cfg(desktop)]
        downloads::choose_download_folder,
        #[cfg(desktop)]
        downloads::reset_download_folder,
        token::token_get,
        token::token_set,
        token::token_clear,
        token::token_adopt_legacy,
        token::token_store_kind,
        #[cfg(desktop)]
        tray::tray_set_servers
    ]);
    // With "close to tray" on, the close button hides the window and the app keeps running
    // (the tray's Quit really exits).
    #[cfg(desktop)]
    let builder = builder.on_window_event(|window, event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if window.label() == "main" && window.state::<prefs::Prefs>().close_to_tray() {
                api.prevent_close();
                let _ = window.hide();
            }
        }
    });
    builder
        .setup(|app| {
            #[cfg(desktop)]
            setup_desktop(app)?;
            #[cfg(mobile)]
            setup_mobile(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Packrat");
}

/// The `main` window as declared in tauri.conf.json (`create: false`, so it is built in code).
fn main_window_config(app: &tauri::App) -> tauri::utils::config::WindowConfig {
    app.config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .expect("main window is declared in tauri.conf.json")
        .clone()
}

#[cfg(desktop)]
fn setup_desktop(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(prefs::load(app.handle()));
    app.manage(match_update::Pending::default());
    app.manage(downloads::Downloads::default());
    downloads::clear_staging(app.handle());
    autostart::repair(app.handle());
    app.manage(token::Vault::keychain());
    // Registered before the tray is built: `tray_set_servers` needs it even when the tray fails.
    app.manage(tray::TrayServers::default());
    // A tray that can't be built isn't fatal; it only means the window is always shown.
    let tray_available = match tray::build(app.handle()) {
        Ok(()) => tray::is_available(),
        Err(err) => {
            eprintln!("system tray unavailable: {err}");
            false
        }
    };
    let hidden = prefs::start_hidden(
        prefs::launched_minimized(std::env::args()),
        app.state::<prefs::Prefs>().start_minimized(),
        tray_available,
    );

    // The window is built here rather than from tauri.conf.json so it can carry a
    // download handler (see downloads.rs).
    let config = main_window_config(app);
    WebviewWindowBuilder::from_config(app.handle(), &config)?
        .visible(!hidden)
        .on_download(downloads::on_download(app.handle().clone()))
        .build()?;
    Ok(())
}

/// Android: tokens go to a file in the app's private data directory (see token.rs), and the one
/// window — which always fills the screen on mobile; the size fields are ignored — is built from
/// the same config entry, without the desktop download handler.
#[cfg(mobile)]
fn setup_mobile(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    app.manage(token::Vault::file(dir.join(token::TOKEN_FILE)));
    let config = main_window_config(app);
    WebviewWindowBuilder::from_config(app.handle(), &config)?.build()?;
    Ok(())
}
