// No console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// The app itself lives in the library crate (src/lib.rs), which the Android build loads as a
// shared library through its mobile entry point; the desktop binary just calls it.
fn main() {
    packrat_desktop_lib::run()
}
