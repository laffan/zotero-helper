// No JS-invokable commands and no events — the app's Rust core proxies
// the single call via run_mobile_plugin.
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .build();
}
