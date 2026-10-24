//! "Match server version": install the app release whose version equals the server's, upgrade or
//! downgrade. The JS updater plugin can't change its endpoint at runtime, so this builds a one-off
//! updater here. The check and the install are separate commands (the UI asks for confirmation in
//! between), with the found update held in managed state.
//!
//! The version comes from the server, i.e. untrusted input. It is only ever used after
//! `release_manifest_url` has validated it as plain `MAJOR.MINOR.PATCH` digits, and the download is
//! still verified against the public key baked into `tauri.conf.json` (`plugins.updater.pubkey`).
//! The version the manifest then offers must equal the requested one exactly (`ensure_requested`).

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State, Url};
use tauri_plugin_updater::{Error as UpdaterError, Update, UpdaterExt};

/// Where the GitHub Releases of this project are downloaded from.
const RELEASE_BASE: &str = "https://github.com/matiss-norenbergs/packrat/releases/download";

/// Emitted while the update downloads; the frontend shows a percentage (`useMatchServerVersion`).
const PROGRESS_EVENT: &str = "match-update-progress";

/// The update found by `match_update_check`, waiting for `match_update_install`.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    version: String,
    current_version: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

/// The base URL releases are fetched from. Debug builds may point it elsewhere with
/// `PACKRAT_UPDATE_BASE_URL` (to test against a local server); the override is compiled out of
/// release builds, so a shipped app can only ever talk to the GitHub releases above.
fn release_base() -> String {
    #[cfg(debug_assertions)]
    {
        if let Ok(base) = std::env::var("PACKRAT_UPDATE_BASE_URL") {
            return base.trim_end_matches('/').to_string();
        }
    }
    RELEASE_BASE.to_string()
}

/// `^\d+\.\d+\.\d+$` with ASCII digits only: no `v` prefix, prerelease, build metadata or anything
/// that could change the shape of a URL.
fn is_release_version(version: &str) -> bool {
    let mut parts = 0;
    for part in version.split('.') {
        parts += 1;
        if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
            return false;
        }
    }
    parts == 3
}

/// The release manifest for `version` under `base`, or an error (before any request is made) if
/// `version` isn't a plain release version.
fn release_manifest_url(base: &str, version: &str) -> Result<Url, String> {
    if !is_release_version(version) {
        return Err(format!("\"{version}\" is not a release version"));
    }
    Url::parse(&format!("{base}/v{version}/latest.json")).map_err(|e| e.to_string())
}

/// The manifest chooses which release it offers (its `version` field), so the version it offers must
/// be exactly the one that was asked for: anything else, including a manifest for a different
/// release or one with prerelease/build metadata, is refused before it can be installed.
fn ensure_requested(requested: &str, offered: &str) -> Result<(), String> {
    if offered == requested {
        Ok(())
    } else {
        Err(format!(
            "The release manifest for {requested} offers version {offered}; refusing to install it"
        ))
    }
}

fn describe(err: UpdaterError, version: &str) -> String {
    match err {
        UpdaterError::ReleaseNotFound => {
            format!("No desktop build is published for server version {version}")
        }
        other => other.to_string(),
    }
}

/// Looks for the release equal to `version`. `None` means the app already is that version.
#[tauri::command]
pub async fn match_update_check(
    app: AppHandle,
    pending: State<'_, Pending>,
    version: String,
) -> Result<Option<Found>, String> {
    *pending.0.lock().unwrap() = None;
    let url = release_manifest_url(&release_base(), &version)?;
    let requested = version.clone();
    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| describe(e, &version))?
        // The default only accepts a newer version; this accepts any different one (so a
        // downgrade works), and also a manifest that isn't for the requested version even when it
        // equals the running one, so `ensure_requested` below reports it instead of it being
        // mistaken for "already up to date".
        .version_comparator(move |current, update| {
            update.version != current || update.version != requested
        })
        .build()
        .map_err(|e| describe(e, &version))?;
    let found = updater.check().await.map_err(|e| describe(e, &version))?;
    let Some(update) = found else {
        return Ok(None);
    };
    ensure_requested(&version, &update.version)?;
    let result = Found {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
    };
    *pending.0.lock().unwrap() = Some(update);
    Ok(Some(result))
}

/// Downloads, verifies and installs the update `match_update_check` found. The frontend relaunches
/// afterwards (on Windows the installer quits the app by itself).
#[tauri::command]
pub async fn match_update_install(
    app: AppHandle,
    pending: State<'_, Pending>,
) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "No update has been checked".to_string())?;
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = app.emit(PROGRESS_EVENT, Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(version: &str) -> Result<String, String> {
        release_manifest_url(RELEASE_BASE, version).map(|u| u.to_string())
    }

    #[test]
    fn builds_the_release_manifest_url() {
        assert_eq!(
            url("0.15.1").unwrap(),
            "https://github.com/matiss-norenbergs/packrat/releases/download/v0.15.1/latest.json"
        );
        assert!(url("10.200.3000").is_ok());
    }

    #[test]
    fn rejects_anything_but_plain_release_versions() {
        for bad in [
            "",
            "dev",
            "v1.2.3",
            "1.2",
            "v1.2",
            "1.2.3.4",
            "1.2.",
            ".1.2",
            "1..2",
            "1.2.3-rc.1",
            "1.2.3+build",
            "1.2.3/../x",
            "1.2.3/../../evil/v9.9.9",
            "1.2.3?x=1",
            "1.2.3#frag",
            "1.2.3 ",
            " 1.2.3",
            "1.2.3\n",
            "1.2.3%2f..",
            "1.2.-3",
            "１.２.３",
            "1.2.3@evil.example",
        ] {
            assert!(url(bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn only_the_requested_version_may_be_offered() {
        assert!(ensure_requested("0.15.1", "0.15.1").is_ok());
        for offered in [
            "0.15.2",      // different patch
            "0.15.0",      // downgrade past the request
            "1.15.1",      // different major
            "0.16.1",      // different minor
            "0.15.1-rc.1", // prerelease
            "0.15.1+build5",
            "v0.15.1",
            " 0.15.1",
            "0.15.1\n",
            "",
        ] {
            let err = ensure_requested("0.15.1", offered).unwrap_err();
            assert!(err.contains("0.15.1") && err.contains("refusing"), "{err}");
        }
        // Equality is symmetric in direction: a request for an older release is held to it too.
        assert!(ensure_requested("0.9.0", "0.9.0").is_ok());
        assert!(ensure_requested("0.9.0", "0.9.1").is_err());
        // Metadata on the requested side doesn't loosen the match either.
        assert!(ensure_requested("0.15.1", "0.15.1+meta").is_err());
    }

    #[test]
    fn a_base_override_keeps_the_same_shape() {
        let u = release_manifest_url("http://127.0.0.1:8000/releases", "1.2.3").unwrap();
        assert_eq!(
            u.as_str(),
            "http://127.0.0.1:8000/releases/v1.2.3/latest.json"
        );
    }
}
