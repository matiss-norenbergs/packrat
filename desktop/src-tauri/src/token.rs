use serde::Serialize;
use tauri::State;

/// Keychain service name = the app identifier.
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

/// Where session tokens can be kept, by account name. A trait so the logic below is testable
/// without a real keychain.
pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    fn clear(&self, account: &str) -> Result<(), String>;
}

/// The OS secret store: Windows Credential Manager, macOS Keychain, Linux Secret Service.
pub struct Keychain;

impl Keychain {
    fn entry(account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())
    }
}

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

pub struct Vault {
    store: Box<dyn SecretStore>,
}

impl Vault {
    pub fn new(store: Box<dyn SecretStore>) -> Self {
        Self { store }
    }

    pub fn keychain() -> Self {
        Self::new(Box::new(Keychain))
    }

    /// "keychain" if the store answers (an empty store counts), "local" if it doesn't — e.g. Linux
    /// without a running Secret Service. The frontend then keeps the token in localStorage.
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
    use std::sync::Mutex;

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

    #[test]
    fn kind_reflects_whether_the_store_answers() {
        assert_eq!(memory_vault().kind(), Kind::Keychain);
        assert_eq!(Vault::new(Box::new(Unavailable)).kind(), Kind::Local);
        assert_eq!(serde_json::to_string(&Kind::Local).unwrap(), "\"local\"");
    }
}
