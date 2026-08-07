#!/usr/bin/env node
// Repository rule: no code file of ANY kind (Rust, TS/TSX, CSS, scripts…)
// may exceed 700 lines. Runs as part of `npm run build`; run standalone via
// `npm run check:lines`. When a file approaches the limit, split it by
// feature (see "Code organization rules" in README.md) — do not raise LIMIT.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIMIT = 700;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["src", "src-tauri", "scripts"];
const EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".rs", ".css", ".scss", ".swift", ".kt", ".html", ".sh",
]);
const SKIP_DIRS = new Set(["node_modules", "target", "dist", "gen", ".git"]);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name));
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      yield path.join(dir, entry.name);
    }
  }
}

const violations = [];
let checked = 0;
for (const dir of SCAN_DIRS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    checked++;
    const lines = fs.readFileSync(file, "utf8").split("\n").length;
    if (lines > LIMIT) {
      violations.push({ file: path.relative(ROOT, file), lines });
    }
  }
}

if (violations.length) {
  console.error(`✗ ${violations.length} file(s) exceed the ${LIMIT}-line limit:\n`);
  for (const v of violations.sort((a, b) => b.lines - a.lines)) {
    console.error(`  ${String(v.lines).padStart(5)}  ${v.file}`);
  }
  console.error(
    "\nSplit these by feature (see 'Code organization rules' in README.md).",
  );
  process.exit(1);
}
console.log(`✓ line limit OK — ${checked} files, all ≤ ${LIMIT} lines`);
