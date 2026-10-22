// No console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod downloads;
mod prefs;
mod token;
mod tray;

use tauri::{Manager, WebviewWindowBuilder, WindowEvent};

fn main() {
    tauri::Builder::default()
        // Must be registered first: a second launch hands over to the running instance, which
        // brings its window forward, instead of opening another copy.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main_window(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            prefs::get_close_to_tray,
            prefs::set_close_to_tray,
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
            app.manage(token::Vault::keychain());
            tray::build(app.handle())?;

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
                .on_download(downloads::on_download(app.handle().clone()))
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Packrat");
}
