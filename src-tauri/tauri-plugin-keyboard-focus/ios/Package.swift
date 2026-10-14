// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-keyboard-focus",
    platforms: [
        .iOS(.v15),
    ],
    products: [
        .library(
            name: "tauri-plugin-keyboard-focus",
            type: .static,
            targets: ["tauri-plugin-keyboard-focus"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-keyboard-focus",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources"
        ),
    ]
)
