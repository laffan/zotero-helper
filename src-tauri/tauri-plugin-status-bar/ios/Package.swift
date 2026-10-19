// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-status-bar",
    platforms: [
        .iOS(.v15),
    ],
    products: [
        .library(
            name: "tauri-plugin-status-bar",
            type: .static,
            targets: ["tauri-plugin-status-bar"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-status-bar",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources"
        ),
    ]
)
