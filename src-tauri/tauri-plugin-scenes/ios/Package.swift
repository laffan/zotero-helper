// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-scenes",
    platforms: [
        .iOS(.v15),
    ],
    products: [
        .library(
            name: "tauri-plugin-scenes",
            type: .static,
            targets: ["tauri-plugin-scenes"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-scenes",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources"
        ),
    ]
)
