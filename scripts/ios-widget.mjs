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
//   the widget's data there). It goes in the spec, as the app target's
//   `entitlements: properties`: XcodeGen writes each target's
//   entitlements file from those properties every time it makes the
//   project, so the file itself can't be edited — Tauri's spec names
//   the file with no properties, and an app group written into it was
//   wiped by the `xcodegen generate` below (the app was then signed
//   without it, and couldn't reach the folder);
// - the signing team kept: making the project again would drop a team
//   set in Xcode, so the one the project has (or APPLE_DEVELOPMENT_TEAM,
//   or tauri.conf.json's bundle > iOS > developmentTeam) is written into
//   the spec, for the app and the widget alike;
// - the least iOS (IOS_MIN, tauri.conf.json's bundle > iOS >
//   minimumSystemVersion) for every target: Tauri writes that value into
//   the spec only when `tauri ios init` makes it, as the project's
//   default, so a spec made under an older minimum keeps it — and the
//   widget's target its own. Every iOS version in the spec below it is
//   raised, and the widget's is also written as a build setting of its
//   own (IPHONEOS_DEPLOYMENT_TARGET), which a target's settings can't
//   lose. The project made, its build settings are read back: a target
//   still below the minimum stops the script here, saying so, rather
//   than the build later with Swift errors about API availability.
//
// Run again after `tauri ios init` (which writes project.yml afresh);
// npm run ios:deploy does it when the widget or the app's group is
// missing, or any iOS version in the spec or the made project is below
// IOS_MIN. With --if-needed it does nothing when all is as it should be.
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
/** The least iOS the app and its widget run on. */
const IOS_MIN = String(conf.bundle?.iOS?.minimumSystemVersion ?? "26.0");
const identifier = conf.identifier;
const group = `group.${identifier}`;
let spec = fs.readFileSync(SPEC, "utf8");
const appName = spec.match(/^ {2}(\S+)_iOS:\s*$/m)?.[1];
if (!appName) fail("no <app>_iOS target in project.yml — is it Tauri's?");
const APP = `${appName}_iOS`;

/** A target's part of the spec: [start, end) — its line up to the next
 *  target, or the next key at the top level. */
function targetBlock(text, name) {
  const start = text.indexOf(`\n  ${name}:\n`) + 1;
  const rest = text.slice(start + name.length + 4);
  const next = rest.search(/^ {0,2}\S/m);
  return [start, next < 0 ? text.length : start + name.length + 4 + next];
}
const appBlock = (text) => targetBlock(text, APP);
const appHasGroup = (text) => {
  const [a, b] = appBlock(text);
  return text.slice(a, b).includes(`- ${group}`);
};

/** Is version `v` ("15.0", "17") below IOS_MIN? */
function below(v) {
  const a = v.split(".").map(Number);
  const b = IOS_MIN.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d < 0;
  }
  return false;
}

/** The spec with every iOS version below IOS_MIN raised to it — the
 *  project's (options > deploymentTarget > iOS), a target's
 *  `deploymentTarget`, an IPHONEOS_DEPLOYMENT_TARGET setting — and the
 *  widget's written as a setting of its own as well. */
function raiseIos(text) {
  const up = (m, head, v) => (below(v) ? `${head}"${IOS_MIN}"` : m);
  let out = text
    .replace(/^([ \t]+deploymentTarget:\n[ \t]+iOS: )"?(\d+(?:\.\d+)*)"?[ \t]*$/gm, up)
    .replace(/^([ \t]+deploymentTarget: )"?(\d+(?:\.\d+)*)"?[ \t]*$/gm, up)
    .replace(/^([ \t]+IPHONEOS_DEPLOYMENT_TARGET: )"?(\d+(?:\.\d+)*)"?[ \t]*$/gm, up);
  if (out.includes(`\n  ${WIDGET}:\n`)) {
    const [a, b] = targetBlock(out, WIDGET);
    const block = out.slice(a, b);
    if (!/^ {8}IPHONEOS_DEPLOYMENT_TARGET:/m.test(block)) {
      const set = block.replace(/^( {8}PRODUCT_NAME: .*\n)/m, `$1        IPHONEOS_DEPLOYMENT_TARGET: "${IOS_MIN}"\n`);
      out = `${out.slice(0, a)}${set}${out.slice(b)}`;
    }
  }
  return out;
}

const pbxproj = path.join(APPLE, `${appName}.xcodeproj`, "project.pbxproj");
/** The iOS versions below IOS_MIN that the made project builds for. */
const staleInProject = () =>
  fs.existsSync(pbxproj)
    ? [...fs.readFileSync(pbxproj, "utf8").matchAll(/IPHONEOS_DEPLOYMENT_TARGET = "?([\d.]+)"?;/g)]
        .map((m) => m[1])
        .filter(below)
    : [];

const had = spec.includes(`\n  ${WIDGET}:\n`);
const hadGroup = appHasGroup(spec);
const oldIos = raiseIos(spec) !== spec;
const staleProject = staleInProject().length > 0;
if (had && hadGroup && !oldIos && !staleProject && ifNeeded) process.exit(0);

// The signing team: the environment's, the config's, the project's.
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
    deploymentTarget: "${IOS_MIN}"
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
        IPHONEOS_DEPLOYMENT_TARGET: "${IOS_MIN}"
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
spec = raiseIos(spec);
fs.writeFileSync(SPEC, spec);

// The app's own entitlements: the app group, in the spec's properties
// for them (see above), beside any already there.
if (!hadGroup) {
  const [a, b] = appBlock(spec);
  let block = spec.slice(a, b);
  const item = `          - ${group}\n`;
  const key = "        com.apple.security.application-groups:\n";
  if (/\n {4}entitlements:\n/.test(block)) {
    const ent = block.indexOf("\n    entitlements:\n") + 1;
    const after = block.slice(ent + "    entitlements:\n".length);
    const len = after.search(/^ {0,4}\S/m);
    let body = len < 0 ? after : after.slice(0, len);
    if (body.includes(key)) body = body.replace(key, `${key}${item}`);
    else if (/^ {6}properties:\n/m.test(body)) body = body.replace(/^( {6}properties:\n)/m, `$1${key}${item}`);
    else body = `${body}      properties:\n${key}${item}`;
    block = `${block.slice(0, ent)}    entitlements:\n${body}${len < 0 ? "" : after.slice(len)}`;
  } else {
    // No entitlements at all: a file of its own, beside the Info.plist.
    const ent = `    entitlements:\n      path: ${APP}/${APP}.entitlements\n      properties:\n${key}${item}`;
    const at = block.search(/^ {4}(scheme|settings|dependencies):/m);
    block = at < 0 ? `${block}${ent}` : `${block.slice(0, at)}${ent}${block.slice(at)}`;
  }
  spec = `${spec.slice(0, a)}${block}${spec.slice(b)}`;
  fs.writeFileSync(SPEC, spec);
}

console.log(`▸ ${had ? "project.yml already has the widget" : `added ${WIDGET} to project.yml`}`);
if (oldIos) console.log(`▸ iOS ${IOS_MIN} and later: the deployment targets below it raised (project.yml)`);
else if (staleProject) console.log(`▸ the Xcode project builds for an iOS below ${IOS_MIN}: making it again`);
console.log(`▸ app group ${group}: ${hadGroup ? "already in" : "added to"} the app's entitlements (project.yml)`);
if (!team) console.log("  ! no signing team found: set it for both targets in Xcode, or set APPLE_DEVELOPMENT_TEAM and run this again.");
console.log("▸ xcodegen generate");
try {
  execFileSync("xcodegen", ["generate", "--spec", SPEC], { cwd: APPLE, stdio: "inherit" });
} catch (e) {
  fail(`xcodegen failed (${e.message}) — it is what 'tauri ios init' uses: brew install xcodegen`);
}
// The project as made: a target below the minimum would fail the build
// later, with Swift errors about what isn't available yet.
const still = [...new Set(staleInProject())];
if (still.length) {
  fail(
    `the Xcode project still builds for iOS ${still.join(", ")} (IPHONEOS_DEPLOYMENT_TARGET in ${path.relative(ROOT, pbxproj)}), ` +
      `below ${IOS_MIN}. Find where project.yml sets it, raise it, and run npm run ios:widget again.`,
  );
}
console.log(`✓ the widget is in the Xcode project, all of it for iOS ${IOS_MIN} and later; build as usual (npm run ios:deploy).`);
