// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-capture-view",
    platforms: [
        .iOS(.v14),
    ],
    products: [
        .library(
            name: "tauri-plugin-capture-view",
            type: .static,
            targets: ["tauri-plugin-capture-view"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-capture-view",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources"
        ),
    ]
)
