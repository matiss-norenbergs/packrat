use std::sync::Mutex;

use serde::Deserialize;
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

const TRAY_ID: &str = "main";
const SERVER_PREFIX: &str = "server:";
/// Event sent to the main window when a server is picked in the tray menu; the payload is the profile id.
const SWITCH_EVENT: &str = "tray-switch-server";

/// One saved server as the frontend reports it (profiles live in the webview's localStorage).
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct ServerEntry {
    pub id: String,
    pub name: String,
}

/// A server item of the tray menu.
#[derive(Debug, PartialEq)]
pub struct ServerItem {
    pub menu_id: String,
    pub label: String,
    pub checked: bool,
}

/// What the tray should show for a list of servers: the submenu items (empty = no submenu) and the tooltip.
#[derive(Debug, PartialEq)]
pub struct TrayPlan {
    pub items: Vec<ServerItem>,
    pub tooltip: String,
}

/// The servers and the active one last pushed by the frontend, kept to rebuild the menu after a click.
#[derive(Default)]
pub struct TrayServers(Mutex<(Vec<ServerEntry>, Option<String>)>);

/// Profile ids are `[A-Za-z0-9_-]{1,64}`; anything else never becomes a menu item.
pub fn is_valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Pure part of the tray menu: invalid and duplicate ids are dropped, the active server is checked
/// and named in the tooltip.
pub fn plan(servers: &[ServerEntry], active_id: Option<&str>) -> TrayPlan {
    let mut items: Vec<ServerItem> = Vec::new();
    let mut tooltip = String::from("Packrat");
    for server in servers {
        if !is_valid_id(&server.id)
            || items
                .iter()
                .any(|i| i.menu_id == format!("{SERVER_PREFIX}{}", server.id))
        {
            continue;
        }
        let checked = active_id == Some(server.id.as_str());
        let label = if server.name.trim().is_empty() {
            server.id.clone()
        } else {
            server.name.clone()
        };
        if checked {
            tooltip = format!("Packrat \u{2014} {label}");
        }
        items.push(ServerItem {
            menu_id: format!("{SERVER_PREFIX}{}", server.id),
            label,
            checked,
        });
    }
    TrayPlan { items, tooltip }
}

fn build_menu(app: &AppHandle, items: &[ServerItem]) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(app, "show", "Show Packrat", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    if items.is_empty() {
        return Menu::with_items(app, &[&show, &quit]);
    }
    let submenu = Submenu::with_id(app, "servers", "Servers", true)?;
    for item in items {
        submenu.append(&CheckMenuItem::with_id(
            app,
            &item.menu_id,
            &item.label,
            true,
            item.checked,
            None::<&str>,
        )?)?;
    }
    let separator = PredefinedMenuItem::separator(app)?;
    Menu::with_items(app, &[&submenu, &separator, &show, &quit])
}

fn apply(app: &AppHandle, servers: &[ServerEntry], active_id: Option<&str>) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let plan = plan(servers, active_id);
    let menu = build_menu(app, &plan.items)?;
    // Replace the whole menu rather than updating items: in-place updates are unreliable on Linux.
    tray.set_menu(Some(menu))?;
    tray.set_tooltip(Some(plan.tooltip))?;
    Ok(())
}

/// Called by the frontend whenever the saved servers or the active one change.
#[tauri::command]
pub fn tray_set_servers(app: AppHandle, servers: Vec<ServerEntry>, active_id: Option<String>) {
    {
        let state = app.state::<TrayServers>();
        *state.0.lock().unwrap_or_else(|e| e.into_inner()) = (servers.clone(), active_id.clone());
    }
    // A failed rebuild keeps the old menu.
    if let Err(err) = apply(&app, &servers, active_id.as_deref()) {
        eprintln!("tray menu update failed: {err}");
    }
}

fn on_server_clicked(app: &AppHandle, id: &str) {
    show_main_window(app);
    let (servers, active) = {
        let state = app.state::<TrayServers>();
        let guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
        guard.clone()
    };
    if is_valid_id(id) && active.as_deref() != Some(id) {
        if let Err(err) = app.emit_to("main", SWITCH_EVENT, id.to_string()) {
            eprintln!("tray: couldn't send {SWITCH_EVENT}: {err}");
        }
    }
    // A check item toggles itself when clicked; put the marks back to what the frontend reported.
    if let Err(err) = apply(app, &servers, active.as_deref()) {
        eprintln!("tray menu update failed: {err}");
    }
}

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

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(include_bytes!("../icons/icon.png"))?)
        .tooltip("Packrat")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            other => {
                if let Some(id) = other.strip_prefix(SERVER_PREFIX) {
                    on_server_clicked(app, id);
                }
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, name: &str) -> ServerEntry {
        ServerEntry {
            id: id.into(),
            name: name.into(),
        }
    }

    #[test]
    fn no_servers_gives_no_items_and_plain_tooltip() {
        let p = plan(&[], None);
        assert!(p.items.is_empty());
        assert_eq!(p.tooltip, "Packrat");
    }

    #[test]
    fn one_server_without_active_is_unchecked() {
        let p = plan(&[entry("a1", "Home")], None);
        assert_eq!(
            p.items,
            vec![ServerItem {
                menu_id: "server:a1".into(),
                label: "Home".into(),
                checked: false
            }]
        );
        assert_eq!(p.tooltip, "Packrat");
    }

    #[test]
    fn active_server_is_checked_and_named_in_tooltip() {
        let p = plan(&[entry("a1", "Home"), entry("b-2", "NAS")], Some("b-2"));
        assert_eq!(
            p.items.iter().map(|i| i.checked).collect::<Vec<_>>(),
            vec![false, true]
        );
        assert_eq!(p.tooltip, "Packrat \u{2014} NAS");
    }

    #[test]
    fn invalid_and_duplicate_ids_are_dropped() {
        let long = "x".repeat(65);
        let p = plan(
            &[
                entry("ok_1", "Fine"),
                entry("bad id", "Space"),
                entry("a:b", "Colon"),
                entry("", "Empty"),
                entry(&long, "Long"),
                entry("ok_1", "Again"),
            ],
            Some("bad id"),
        );
        assert_eq!(p.items.len(), 1);
        assert_eq!(p.items[0].menu_id, "server:ok_1");
        assert_eq!(p.tooltip, "Packrat");
    }

    #[test]
    fn id_pattern() {
        assert!(is_valid_id("A-z_09"));
        assert!(is_valid_id(&"x".repeat(64)));
        assert!(!is_valid_id(""));
        assert!(!is_valid_id("é"));
    }
}
