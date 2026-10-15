// No commands: JS only subscribes to the plugin's events ("tap",
// "squeeze"), which rides the built-in registerListener /
// removeListener (see permissions).
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .build();
}
