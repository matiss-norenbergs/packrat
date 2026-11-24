//! Session tokens, one per server profile, kept outside the webview.
//!
//! Desktop: the OS keychain (`Keychain`, through the `keyring` crate).
//! Mobile (Android, experimental): `FileStore`, a small JSON file in the app's private data
//! directory. That directory is sandboxed per app by Android, but the file is **not encrypted** —
//! good enough for the spike; moving to an Android Keystore-backed store is a later step.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

/// The token file's name inside the app data directory (mobile).
#[cfg_attr(desktop, allow(dead_code))]
pub const TOKEN_FILE: &str = "session-tokens.json";

/// Keychain service name = the app identifier.
#[cfg(desktop)]
const SERVICE: &str = "io.github.matiss-norenbergs.packrat";
/// The account of the single login the app kept before server profiles existed.
const LEGACY_ACCOUNT: &str = "session-token";

/// The keychain account holding one server profile's session token. The id comes from the
/// frontend, so it is restricted to what the frontend generates (a UUID or a short slug) before it
/// becomes part of an account name.
fn account(id: &str) -> Result<String, String> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if valid {
        Ok(format!("{LEGACY_ACCOUNT}:{id}"))
    } else {
        Err("invalid profile id".into())
    }
}

/// Whether `name` is an account this module produces: the legacy account, or one made by
/// `account`. Stores that persist account names themselves (`FileStore`) refuse anything else.
fn is_account(name: &str) -> bool {
    name == LEGACY_ACCOUNT
        || name
            .strip_prefix(LEGACY_ACCOUNT)
            .and_then(|rest| rest.strip_prefix(':'))
            .is_some_and(|id| account(id).is_ok())
}

/// Where session tokens can be kept, by account name. A trait so the logic below is testable
/// without a real keychain.
pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    fn clear(&self, account: &str) -> Result<(), String>;
}

/// The OS secret store: Windows Credential Manager, macOS Keychain, Linux Secret Service.
#[cfg(desktop)]
pub struct Keychain;

#[cfg(desktop)]
impl Keychain {
    fn entry(account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())
    }
}

#[cfg(desktop)]
impl SecretStore for Keychain {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match Self::entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        Self::entry(account)?
            .set_password(secret)
            .map_err(|e| e.to_string())
    }

    fn clear(&self, account: &str) -> Result<(), String> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// Tokens in one JSON file (`{"account": "token", …}`), for platforms without a keychain the app
/// can use — Android in this spike. Every write replaces the file atomically (a temporary file,
/// synced, then renamed over it) and, on Unix, the file is created readable by the app's user only
/// (0600, its folder 0700). A missing file is an empty store; a file that can't be parsed is
/// treated as empty too (the logins in it are lost and the user signs in again) and is replaced on
/// the next write. NOT encrypted: on Android it relies on the per-app sandbox.
#[cfg_attr(desktop, allow(dead_code))]
pub struct FileStore {
    path: PathBuf,
    // Serializes read-modify-write cycles between concurrent commands.
    lock: Mutex<()>,
}

#[cfg_attr(desktop, allow(dead_code))]
impl FileStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    fn check(account: &str) -> Result<(), String> {
        if is_account(account) {
            Ok(())
        } else {
            Err("invalid account name".into())
        }
    }

    fn read(&self) -> Result<BTreeMap<String, String>, String> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_else(|err| {
                eprintln!("token file unreadable ({err}); starting empty");
                BTreeMap::new()
            })),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(err) => Err(err.to_string()),
        }
    }

    fn write(&self, tokens: &BTreeMap<String, String>) -> Result<(), String> {
        use std::io::Write;

        let dir = self.path.parent().ok_or("token file has no folder")?;
        let mut builder = std::fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
        builder.create(dir).map_err(|e| e.to_string())?;

        let json = serde_json::to_vec(tokens).map_err(|e| e.to_string())?;
        let tmp = self.path.with_extension("json.tmp");
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let result = options
            .open(&tmp)
            .and_then(|mut file| {
                file.write_all(&json)?;
                file.sync_all()
            })
            .and_then(|()| std::fs::rename(&tmp, &self.path));
        if result.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        result.map_err(|e| e.to_string())
    }

    /// Applies `change` to the stored map and saves it if `change` says something changed.
    fn update(
        &self,
        change: impl FnOnce(&mut BTreeMap<String, String>) -> bool,
    ) -> Result<(), String> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut tokens = self.read()?;
        if change(&mut tokens) {
            self.write(&tokens)?;
        }
        Ok(())
    }
}

impl SecretStore for FileStore {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Self::check(account)?;
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        Ok(self.read()?.get(account).cloned())
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        Self::check(account)?;
        self.update(|tokens| {
            tokens.insert(account.to_string(), secret.to_string());
            true
        })
    }

    fn clear(&self, account: &str) -> Result<(), String> {
        Self::check(account)?;
        // Nothing to clear means nothing to write (no file is created for it).
        self.update(|tokens| tokens.remove(account).is_some())
    }
}

pub struct Vault {
    store: Box<dyn SecretStore>,
}

impl Vault {
    pub fn new(store: Box<dyn SecretStore>) -> Self {
        Self { store }
    }

    #[cfg(desktop)]
    pub fn keychain() -> Self {
        Self::new(Box::new(Keychain))
    }

    /// Mobile: tokens in a file in the app's private storage (see `FileStore`).
    #[cfg(mobile)]
    pub fn file(path: PathBuf) -> Self {
        Self::new(Box::new(FileStore::new(path)))
    }

    /// "keychain" if the store answers (an empty store counts), "local" if it doesn't — e.g. Linux
    /// without a running Secret Service. The frontend then keeps the token in localStorage. The
    /// mobile file store also reports "keychain" ("the shell keeps the token"); the frontend labels
    /// it as app storage there.
    fn kind(&self) -> Kind {
        match self.store.get(LEGACY_ACCOUNT) {
            Ok(_) => Kind::Keychain,
            Err(_) => Kind::Local,
        }
    }

    fn get(&self, id: &str) -> Result<Option<String>, String> {
        self.store.get(&account(id)?)
    }

    fn set(&self, id: &str, token: &str) -> Result<(), String> {
        self.store.set(&account(id)?, token)
    }

    fn clear(&self, id: &str) -> Result<(), String> {
        self.store.clear(&account(id)?)
    }

    /// Moves the pre-profiles login (the single `session-token` entry) to profile `id`'s own
    /// account, and removes it. An existing token of the profile wins over the legacy one. Safe to
    /// repeat: with no legacy entry it does nothing.
    fn adopt_legacy(&self, id: &str) -> Result<(), String> {
        let target = account(id)?;
        let Some(legacy) = self.store.get(LEGACY_ACCOUNT)? else {
            return Ok(());
        };
        if self.store.get(&target)?.is_none() {
            self.store.set(&target, &legacy)?;
        }
        self.store.clear(LEGACY_ACCOUNT)
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Keychain,
    Local,
}

#[tauri::command]
pub fn token_get(vault: State<'_, Vault>, id: String) -> Result<Option<String>, String> {
    vault.get(&id)
}

#[tauri::command]
pub fn token_set(vault: State<'_, Vault>, id: String, token: String) -> Result<(), String> {
    vault.set(&id, &token)
}

#[tauri::command]
pub fn token_clear(vault: State<'_, Vault>, id: String) -> Result<(), String> {
    vault.clear(&id)
}

#[tauri::command]
pub fn token_adopt_legacy(vault: State<'_, Vault>, id: String) -> Result<(), String> {
    vault.adopt_legacy(&id)
}

#[tauri::command]
pub fn token_store_kind(vault: State<'_, Vault>) -> Kind {
    vault.kind()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct Memory(Mutex<HashMap<String, String>>);

    impl SecretStore for Memory {
        fn get(&self, account: &str) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().get(account).cloned())
        }
        fn set(&self, account: &str, secret: &str) -> Result<(), String> {
            self.0
                .lock()
                .unwrap()
                .insert(account.to_string(), secret.to_string());
            Ok(())
        }
        fn clear(&self, account: &str) -> Result<(), String> {
            self.0.lock().unwrap().remove(account);
            Ok(())
        }
    }

    struct Unavailable;

    impl SecretStore for Unavailable {
        fn get(&self, _: &str) -> Result<Option<String>, String> {
            Err("no secret service".into())
        }
        fn set(&self, _: &str, _: &str) -> Result<(), String> {
            Err("no secret service".into())
        }
        fn clear(&self, _: &str) -> Result<(), String> {
            Err("no secret service".into())
        }
    }

    fn memory_vault() -> Vault {
        Vault::new(Box::new(Memory::default()))
    }

    #[test]
    fn round_trips_and_clears() {
        let vault = memory_vault();
        assert_eq!(vault.get("a"), Ok(None));
        vault.set("a", "abc").unwrap();
        assert_eq!(vault.get("a"), Ok(Some("abc".into())));
        vault.clear("a").unwrap();
        assert_eq!(vault.get("a"), Ok(None));
    }

    #[test]
    fn profiles_have_separate_tokens() {
        let vault = memory_vault();
        vault.set("one", "t1").unwrap();
        vault.set("two", "t2").unwrap();
        assert_eq!(vault.get("one"), Ok(Some("t1".into())));
        assert_eq!(vault.get("two"), Ok(Some("t2".into())));
        // Clearing one leaves the other alone.
        vault.clear("one").unwrap();
        assert_eq!(vault.get("one"), Ok(None));
        assert_eq!(vault.get("two"), Ok(Some("t2".into())));
    }

    #[test]
    fn account_names_reject_odd_ids() {
        assert_eq!(account("abc-123_X").unwrap(), "session-token:abc-123_X");
        assert!(account("").is_err());
        assert!(account("a:b").is_err());
        assert!(account("../x").is_err());
        assert!(account(&"a".repeat(65)).is_err());
        assert!(memory_vault().set("bad id", "t").is_err());
    }

    #[test]
    fn adopting_the_legacy_login_moves_it_to_the_profile() {
        let vault = memory_vault();
        vault.store.set(LEGACY_ACCOUNT, "old").unwrap();
        vault.adopt_legacy("first").unwrap();
        assert_eq!(vault.get("first"), Ok(Some("old".into())));
        assert_eq!(vault.store.get(LEGACY_ACCOUNT), Ok(None));
        // Repeating is harmless, and does not touch other profiles.
        vault.set("second", "other").unwrap();
        vault.adopt_legacy("first").unwrap();
        assert_eq!(vault.get("first"), Ok(Some("old".into())));
        assert_eq!(vault.get("second"), Ok(Some("other".into())));
    }

    #[test]
    fn adopting_never_overwrites_a_profiles_own_token() {
        let vault = memory_vault();
        vault.store.set(LEGACY_ACCOUNT, "old").unwrap();
        vault.set("first", "newer").unwrap();
        vault.adopt_legacy("first").unwrap();
        assert_eq!(vault.get("first"), Ok(Some("newer".into())));
        assert_eq!(vault.store.get(LEGACY_ACCOUNT), Ok(None));
    }

    /// A fresh, empty folder for one test's token file.
    fn scratch(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("packrat-token-test-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn file_vault(dir: &std::path::Path) -> Vault {
        Vault::new(Box::new(FileStore::new(
            dir.join("nested").join(TOKEN_FILE),
        )))
    }

    #[test]
    fn file_store_round_trips_across_instances() {
        let dir = scratch("round-trip");
        let vault = file_vault(&dir);
        assert_eq!(vault.get("a"), Ok(None), "no file yet is an empty store");
        assert_eq!(
            vault.kind(),
            Kind::Keychain,
            "an empty file store still answers"
        );
        vault.set("a", "abc").unwrap();
        vault.set("b", "def").unwrap();
        vault.set("a", "abc2").unwrap();
        // A new store over the same file (an app restart) sees the same tokens.
        let reopened = file_vault(&dir);
        assert_eq!(reopened.get("a"), Ok(Some("abc2".into())));
        assert_eq!(reopened.get("b"), Ok(Some("def".into())));
        assert!(
            !dir.join("nested").join("session-tokens.json.tmp").exists(),
            "the temporary file is renamed away"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn file_store_clears_one_account_only() {
        let dir = scratch("clear");
        let vault = file_vault(&dir);
        // Clearing in an empty store is fine and creates no file.
        vault.clear("a").unwrap();
        assert!(!dir.join("nested").join(TOKEN_FILE).exists());
        vault.set("a", "t1").unwrap();
        vault.set("b", "t2").unwrap();
        vault.clear("a").unwrap();
        assert_eq!(vault.get("a"), Ok(None));
        assert_eq!(vault.get("b"), Ok(Some("t2".into())));
        // The legacy login moves through the same store.
        vault.store.set(LEGACY_ACCOUNT, "old").unwrap();
        vault.adopt_legacy("c").unwrap();
        assert_eq!(vault.get("c"), Ok(Some("old".into())));
        assert_eq!(vault.store.get(LEGACY_ACCOUNT), Ok(None));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn file_store_refuses_invalid_account_names() {
        let dir = scratch("invalid");
        let vault = file_vault(&dir);
        assert!(vault.set("bad id", "t").is_err());
        assert!(vault.get("../x").is_err());
        assert!(vault.clear("").is_err());
        // The store checks names itself too, not only through the vault.
        let store = FileStore::new(dir.join(TOKEN_FILE));
        assert!(store.set("anything", "t").is_err());
        assert!(store.set("session-token:", "t").is_err());
        assert!(store.set("session-token:a:b", "t").is_err());
        assert!(store.get("session-token-x").is_err());
        assert!(store.set(LEGACY_ACCOUNT, "t").is_ok());
        assert!(store.set("session-token:abc-1_X", "t").is_ok());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_corrupt_file_store_starts_empty_and_is_replaced() {
        let dir = scratch("corrupt");
        let path = dir.join(TOKEN_FILE);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, "{not json").unwrap();
        let vault = Vault::new(Box::new(FileStore::new(path.clone())));
        assert_eq!(vault.kind(), Kind::Keychain);
        assert_eq!(vault.get("a"), Ok(None));
        vault.set("a", "fresh").unwrap();
        assert_eq!(vault.get("a"), Ok(Some("fresh".into())));
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(json["session-token:a"], "fresh");
        // A file of the wrong shape (valid JSON, not a map of strings) is treated the same way.
        std::fs::write(&path, "[1, 2]").unwrap();
        assert_eq!(vault.get("a"), Ok(None));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn the_token_file_is_private_to_the_user() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("perms");
        let vault = file_vault(&dir);
        vault.set("a", "t").unwrap();
        let file = dir.join("nested").join(TOKEN_FILE);
        let mode = std::fs::metadata(&file).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        let mode = std::fs::metadata(dir.join("nested"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o700);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn kind_reflects_whether_the_store_answers() {
        assert_eq!(memory_vault().kind(), Kind::Keychain);
        assert_eq!(Vault::new(Box::new(Unavailable)).kind(), Kind::Local);
        assert_eq!(serde_json::to_string(&Kind::Local).unwrap(), "\"local\"");
    }
}
