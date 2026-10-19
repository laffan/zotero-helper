// JS calls `refresh` once as it boots, so the page hears whether the
// bar is hidden (see permissions).
const COMMANDS: &[&str] = &["refresh"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .build();
}
