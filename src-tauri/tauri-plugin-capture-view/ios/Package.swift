// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-capture-view",
    platforms: [
        // WKDownload (the PDF interception path) needs 14.5; the app
        // itself only ever ships to far newer iPadOS anyway.
        .iOS("14.5"),
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
