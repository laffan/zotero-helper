// No commands: the Swift side does its work as it loads, the Rust side
// as the system asks for a scene.
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .build();
}
