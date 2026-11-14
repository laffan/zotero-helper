// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-widget",
    platforms: [
        .iOS(.v15),
    ],
    products: [
        .library(
            name: "tauri-plugin-widget",
            type: .static,
            targets: ["tauri-plugin-widget"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-widget",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources"
        ),
    ]
)
