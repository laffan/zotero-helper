// No JS-invokable commands — the app's Rust core proxies every call via
// run_mobile_plugin. JS only subscribes to this plugin's events, which
// rides the built-in registerListener/removeListener (see permissions).
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .build();
}
