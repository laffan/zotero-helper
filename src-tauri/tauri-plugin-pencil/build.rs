// JS subscribes to the plugin's events ("tap", "squeeze") through the
// built-in registerListener / removeListener, and calls
// `hide_edit_menu` (see permissions).
const COMMANDS: &[&str] = &["hide_edit_menu"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .build();
}
