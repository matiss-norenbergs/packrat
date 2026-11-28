//! The window and tray icon in the user's primary color. The webview renders the logo to a PNG
//! (frontend/src/lib/appIcon.ts) and sends it here; the last one is kept in the config directory so
//! the next start builds the window and tray with it instead of flashing the bundled icon.
//! macOS has no per-window icon, so only the tray changes there.

use std::path::{Path, PathBuf};

use tauri::{image::Image, AppHandle, Manager, Runtime};

/// The logo is drawn at 256x256 (a few KB as PNG); anything near this is not ours.
const MAX_PNG_BYTES: usize = 1024 * 1024;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
const FILE_NAME: &str = "app-icon.png";

/// Rejects anything that is clearly not a PNG of a sensible size before it is decoded.
pub fn validate_png(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("empty icon".into());
    }
    if bytes.len() > MAX_PNG_BYTES {
        return Err(format!("icon larger than {MAX_PNG_BYTES} bytes"));
    }
    if !bytes.starts_with(&PNG_SIGNATURE) {
        return Err("icon is not a PNG".into());
    }
    Ok(())
}

fn file_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(FILE_NAME))
}

/// Validates and decodes; the error says why the icon was refused.
fn decode(bytes: &[u8]) -> Result<Image<'static>, String> {
    validate_png(bytes)?;
    Image::from_bytes(bytes).map_err(|e| e.to_string())
}

/// The icon saved by the last run, if there is a valid one.
pub fn load_saved<R: Runtime>(app: &AppHandle<R>) -> Option<Image<'static>> {
    let bytes = std::fs::read(file_path(app)?).ok()?;
    decode(&bytes).ok()
}

fn save(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if std::fs::read(path).is_ok_and(|old| old == bytes) {
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

/// Called by the frontend whenever the primary color is known or changes.
#[tauri::command]
pub fn set_app_icon(app: AppHandle, png: Vec<u8>) -> Result<(), String> {
    let image = decode(&png)?;
    if let Some(window) = app.get_webview_window("main") {
        // Unsupported on macOS (no per-window icon); not worth failing the tray update for.
        if let Err(err) = window.set_icon(image.clone()) {
            eprintln!("window icon update failed: {err}");
        }
    }
    // No tray (it failed to build, or not yet) is not an error.
    if let Some(tray) = app.tray_by_id(crate::tray::TRAY_ID) {
        if let Err(err) = tray.set_icon(Some(image)) {
            eprintln!("tray icon update failed: {err}");
        }
    }
    // Best effort: losing it only costs one frame of the bundled icon at the next start.
    if let Some(path) = file_path(&app) {
        if let Err(err) = save(&path, &png) {
            eprintln!("saving the app icon failed: {err}");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A valid 1x1 PNG.
    const PIXEL: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
        0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8,
        0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00,
        0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];

    #[test]
    fn accepts_a_png() {
        assert_eq!(validate_png(PIXEL), Ok(()));
        assert!(decode(PIXEL).is_ok());
    }

    #[test]
    fn rejects_empty_oversized_and_non_png_payloads() {
        assert!(validate_png(&[]).is_err());
        let mut big = PNG_SIGNATURE.to_vec();
        big.resize(MAX_PNG_BYTES + 1, 0);
        assert!(validate_png(&big).is_err());
        assert!(validate_png(b"GIF89a....").is_err());
        assert!(validate_png(&PIXEL[..4]).is_err());
    }

    #[test]
    fn a_png_header_with_garbage_after_it_fails_to_decode_without_panicking() {
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(b"not really");
        assert_eq!(validate_png(&bytes), Ok(()));
        assert!(decode(&bytes).is_err());
    }

    #[test]
    fn saving_the_same_bytes_twice_and_garbage_paths() {
        let dir = std::env::temp_dir().join(format!("packrat-icon-test-{}", std::process::id()));
        let file = dir.join("nested").join(FILE_NAME);
        save(&file, PIXEL).unwrap();
        save(&file, PIXEL).unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), PIXEL);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
