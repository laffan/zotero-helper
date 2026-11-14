#!/usr/bin/env node
// Add the Continue Reading widget (src-tauri/ios-widget/) to the Xcode
// project Tauri generates, src-tauri/gen/apple — which is made on the Mac
// by `npm run tauri ios init`, from an XcodeGen spec (project.yml), and
// isn't kept in the repository. So the widget's target is added to that
// spec here, and the project made again from it with XcodeGen (which
// `tauri ios init` needed already):
//
// - a `ZoteroHelperWidget` app extension built from
//   src-tauri/ios-widget/Sources, its Info.plist and entitlements made by
//   XcodeGen (the WidgetKit extension point; the app group);
// - the app embedding it;
// - the app group (`group.<identifier>`) in the app's own entitlements,
//   so the app and the widget share a folder (tauri-plugin-widget writes
//   the widget's data there);
// - the signing team kept: making the project again would drop a team
//   set in Xcode, so the one the project has (or APPLE_DEVELOPMENT_TEAM,
//   or tauri.conf.json's bundle > iOS > developmentTeam) is written into
//   the spec, for the app and the widget alike.
//
// Run again after `tauri ios init` (which writes project.yml afresh);
// npm run ios:deploy does it when the widget is missing. With
// --if-needed it does nothing when the spec already has the widget.
// Usage: npm run ios:widget [-- --if-needed]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPLE = path.join(ROOT, "src-tauri", "gen", "apple");
const SPEC = path.join(APPLE, "project.yml");
const WIDGET = "ZoteroHelperWidget";
const ifNeeded = process.argv.includes("--if-needed");

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(SPEC)) fail("src-tauri/gen/apple/project.yml missing — run 'npm run tauri ios init' first.");
const conf = JSON.parse(fs.readFileSync(path.join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"));
const identifier = conf.identifier;
const group = `group.${identifier}`;
let spec = fs.readFileSync(SPEC, "utf8");
const had = spec.includes(`\n  ${WIDGET}:\n`);
if (had && ifNeeded) process.exit(0);

const appName = spec.match(/^ {2}(\S+)_iOS:\s*$/m)?.[1];
if (!appName) fail("no <app>_iOS target in project.yml — is it Tauri's?");

// The signing team: the environment's, the config's, the project's.
const pbxproj = path.join(APPLE, `${appName}.xcodeproj`, "project.pbxproj");
const fromProject = fs.existsSync(pbxproj)
  ? fs.readFileSync(pbxproj, "utf8").match(/DEVELOPMENT_TEAM = "?([A-Z0-9]{10})"?;/)?.[1]
  : undefined;
const team =
  process.env.APPLE_DEVELOPMENT_TEAM || conf.bundle?.iOS?.developmentTeam || fromProject || spec.match(/DEVELOPMENT_TEAM: (\S+)/)?.[1];

// Keep the team for the app: a project made again from the spec
// otherwise loses one set in Xcode.
if (team && !/^ {6}DEVELOPMENT_TEAM:/m.test(spec)) {
  spec = spec.replace(/^(settingGroups:\n {2}app:\n {4}base:\n)/m, `$1      DEVELOPMENT_TEAM: ${team}\n`);
}

if (!had) {
  // The app embeds the widget: the first dependency of its target.
  const appStart = spec.indexOf(`\n  ${appName}_iOS:\n`);
  const deps = spec.indexOf("\n    dependencies:\n", appStart);
  if (appStart < 0 || deps < 0) fail(`no dependencies list in ${appName}_iOS`);
  const at = deps + "\n    dependencies:\n".length;
  spec = `${spec.slice(0, at)}      - target: ${WIDGET}\n        embed: true\n${spec.slice(at)}`;

  const version = conf.version ?? "1.0";
  const build = spec.match(/CFBundleVersion: "?([^"\n]+)"?/)?.[1] ?? version;
  const target = `
  ${WIDGET}:
    type: app-extension
    platform: iOS
    deploymentTarget: "15.0"
    sources:
      - path: ../../ios-widget/Sources
    info:
      path: ${WIDGET}/Info.plist
      properties:
        CFBundleDisplayName: Zotero Helper
        CFBundleShortVersionString: "${version}"
        CFBundleVersion: "${build}"
        NSExtension:
          NSExtensionPointIdentifier: com.apple.widgetkit-extension
    entitlements:
      path: ${WIDGET}/${WIDGET}.entitlements
      properties:
        com.apple.security.application-groups:
          - ${group}
    settings:
      base:
        PRODUCT_NAME: ${WIDGET}
        PRODUCT_BUNDLE_IDENTIFIER: ${identifier}.widget
        CODE_SIGN_STYLE: Automatic
${team ? `        DEVELOPMENT_TEAM: ${team}\n` : ""}        SWIFT_VERSION: "5.0"
        TARGETED_DEVICE_FAMILY: "1,2"
        SKIP_INSTALL: true
        LD_RUNPATH_SEARCH_PATHS: "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"
    dependencies:
      - sdk: WidgetKit.framework
      - sdk: SwiftUI.framework
`;
  spec = `${spec.replace(/\s*$/, "\n")}${target}`;
}
fs.writeFileSync(SPEC, spec);

// The app's own entitlements: the app group, beside whatever is there.
const ent = path.join(APPLE, `${appName}_iOS`, `${appName}_iOS.entitlements`);
let plist = fs.existsSync(ent)
  ? fs.readFileSync(ent, "utf8")
  : `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n</dict>\n</plist>\n`;
if (!plist.includes(`<string>${group}</string>`)) {
  plist = plist.replace("<dict/>", "<dict>\n</dict>");
  const entry = plist.includes("com.apple.security.application-groups")
    ? null
    : `\t<key>com.apple.security.application-groups</key>\n\t<array>\n\t\t<string>${group}</string>\n\t</array>\n`;
  if (entry) {
    const end = plist.lastIndexOf("</dict>");
    plist = `${plist.slice(0, end)}${entry}${plist.slice(end)}`;
  } else {
    plist = plist.replace(
      /(<key>com\.apple\.security\.application-groups<\/key>\s*<array>)/,
      `$1\n\t\t<string>${group}</string>`,
    );
  }
  fs.writeFileSync(ent, plist);
}

console.log(`▸ ${had ? "project.yml already has the widget" : `added ${WIDGET} to project.yml`}; app group ${group}`);
if (!team) console.log("  ! no signing team found: set it for both targets in Xcode, or set APPLE_DEVELOPMENT_TEAM and run this again.");
console.log("▸ xcodegen generate");
try {
  execFileSync("xcodegen", ["generate", "--spec", SPEC], { cwd: APPLE, stdio: "inherit" });
} catch (e) {
  fail(`xcodegen failed (${e.message}) — it is what 'tauri ios init' uses: brew install xcodegen`);
}
console.log("✓ the widget is in the Xcode project; build as usual (npm run ios:deploy).");
