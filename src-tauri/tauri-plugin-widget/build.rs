// JS calls `update` (the widget's PDFs and their pages' thumbnails) and
// `take_open_url` (a link the app was opened with), see permissions.
const COMMANDS: &[&str] = &["update", "take_open_url"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .build();
}
