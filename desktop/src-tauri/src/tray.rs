use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

/// Brings the main window to the front, un-hiding and un-minimizing it first.
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Whether a tray icon can actually be seen. Building one succeeds nearly everywhere, but on Linux
/// the icon only shows when something on the session bus hosts indicators (a StatusNotifier
/// watcher — KDE, most panels, GNOME with an extension); without one it is created and invisible.
#[cfg(target_os = "linux")]
pub fn is_available() -> bool {
    use std::time::Duration;

    let Ok(conn) = dbus::blocking::Connection::new_session() else {
        return false;
    };
    let bus = conn.with_proxy(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        Duration::from_millis(1500),
    );
    [
        "org.kde.StatusNotifierWatcher",
        "org.freedesktop.StatusNotifierWatcher",
    ]
    .iter()
    .any(|name| {
        bus.method_call::<(bool,), _, _, _>("org.freedesktop.DBus", "NameHasOwner", (*name,))
            .map(|(has_owner,)| has_owner)
            .unwrap_or(false)
    })
}

/// Windows and macOS always have a notification area / menu bar.
#[cfg(not(target_os = "linux"))]
pub fn is_available() -> bool {
    true
}

/// Tray icon: left click (or "Show Packrat") restores the window, "Quit" exits the app for real.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Packrat", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(include_bytes!("../icons/icon.png"))?)
        .tooltip("Packrat")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
