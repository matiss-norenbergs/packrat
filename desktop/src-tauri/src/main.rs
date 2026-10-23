// No console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod downloads;
mod match_update;
mod prefs;
mod token;
mod tray;

use tauri::{Manager, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_window_state::StateFlags;

fn main() {
    tauri::Builder::default()
        // Must be registered first: a second launch hands over to the running instance, which
        // brings its window forward, instead of opening another copy.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // An autostart entry firing while the app already runs must not pop the window up.
            if !prefs::launched_minimized(&args) {
                tray::show_main_window(app);
            }
        }))
        // The "Launch at login" switch (Settings → Desktop) enables/disables this entry; the
        // argument lets the app tell an autostart launch from a manual one.
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![prefs::MINIMIZED_ARG]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        // Size and position only, never visibility: the plugin would otherwise show the window again
        // right after it was created hidden for a "start minimized" launch.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            match_update::match_update_check,
            match_update::match_update_install,
            prefs::get_close_to_tray,
            prefs::set_close_to_tray,
            prefs::get_start_minimized,
            prefs::set_start_minimized,
            token::token_get,
            token::token_set,
            token::token_clear,
            token::token_store_kind
        ])
        .on_window_event(|window, event| {
            // With "close to tray" on, the close button hides the window and the app keeps running
            // (the tray's Quit really exits).
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && window.state::<prefs::Prefs>().close_to_tray() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            app.manage(prefs::load(app.handle()));
            app.manage(match_update::Pending::default());
            app.manage(token::Vault::keychain());
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
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .expect("main window is declared in tauri.conf.json")
                .clone();
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                .visible(!hidden)
                .on_download(downloads::on_download(app.handle().clone()))
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Packrat");
}
