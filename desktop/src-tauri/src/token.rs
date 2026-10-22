use serde::Serialize;
use tauri::State;

/// Keychain service name = the app identifier; the single account holds the session token.
const SERVICE: &str = "io.github.matiss-norenbergs.packrat";
const ACCOUNT: &str = "session-token";

/// Where the session token can be kept. A trait so the logic below is testable without a real
/// keychain.
pub trait SecretStore: Send + Sync {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, secret: &str) -> Result<(), String>;
    fn clear(&self) -> Result<(), String>;
}

/// The OS secret store: Windows Credential Manager, macOS Keychain, Linux Secret Service.
pub struct Keychain;

impl Keychain {
    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
    }
}

impl SecretStore for Keychain {
    fn get(&self) -> Result<Option<String>, String> {
        match Self::entry()?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    fn set(&self, secret: &str) -> Result<(), String> {
        Self::entry()?
            .set_password(secret)
            .map_err(|e| e.to_string())
    }

    fn clear(&self) -> Result<(), String> {
        match Self::entry()?.delete_credential() {
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
        match self.store.get() {
            Ok(_) => Kind::Keychain,
            Err(_) => Kind::Local,
        }
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Keychain,
    Local,
}

#[tauri::command]
pub fn token_get(vault: State<'_, Vault>) -> Result<Option<String>, String> {
    vault.store.get()
}

#[tauri::command]
pub fn token_set(vault: State<'_, Vault>, token: String) -> Result<(), String> {
    vault.store.set(&token)
}

#[tauri::command]
pub fn token_clear(vault: State<'_, Vault>) -> Result<(), String> {
    vault.store.clear()
}

#[tauri::command]
pub fn token_store_kind(vault: State<'_, Vault>) -> Kind {
    vault.kind()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Memory(Mutex<Option<String>>);

    impl SecretStore for Memory {
        fn get(&self) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn set(&self, secret: &str) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(secret.to_string());
            Ok(())
        }
        fn clear(&self) -> Result<(), String> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    struct Unavailable;

    impl SecretStore for Unavailable {
        fn get(&self) -> Result<Option<String>, String> {
            Err("no secret service".into())
        }
        fn set(&self, _: &str) -> Result<(), String> {
            Err("no secret service".into())
        }
        fn clear(&self) -> Result<(), String> {
            Err("no secret service".into())
        }
    }

    #[test]
    fn round_trips_and_clears() {
        let vault = Vault::new(Box::new(Memory::default()));
        assert_eq!(vault.store.get(), Ok(None));
        vault.store.set("abc").unwrap();
        assert_eq!(vault.store.get(), Ok(Some("abc".into())));
        vault.store.clear().unwrap();
        assert_eq!(vault.store.get(), Ok(None));
    }

    #[test]
    fn kind_reflects_whether_the_store_answers() {
        assert_eq!(
            Vault::new(Box::new(Memory::default())).kind(),
            Kind::Keychain
        );
        assert_eq!(Vault::new(Box::new(Unavailable)).kind(), Kind::Local);
        assert_eq!(serde_json::to_string(&Kind::Local).unwrap(), "\"local\"");
    }
}
