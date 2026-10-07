import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// pdf.js fetches some of its decoders and data at run time, by URL: the
// WebAssembly JBIG2 / JPEG 2000 decoders that scanned PDFs need, ICC
// colour profiles, the standard fonts and the CJK CMaps. They ship as
// directories in pdfjs-dist; this serves them under /pdfjs/ in dev and
// copies them into the build, and src/lib/pdfjsAssets.ts points pdf.js
// at them.
const PDFJS_DIRS = ["wasm", "iccs", "standard_fonts", "cmaps"];
const PDFJS_ROOT = fileURLToPath(new URL("./node_modules/pdfjs-dist", import.meta.url));

function pdfjsAssets(): Plugin {
  return {
    name: "pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs", (req, res, next) => {
        const [dir, file] = decodeURIComponent((req.url ?? "").split("?")[0])
          .replace(/^\//, "")
          .split("/");
        if (!PDFJS_DIRS.includes(dir) || !file || file.includes("..")) return next();
        const full = path.join(PDFJS_ROOT, dir, file);
        if (!fs.existsSync(full)) return next();
        const type = file.endsWith(".wasm")
          ? "application/wasm"
          : file.endsWith(".js")
            ? "text/javascript"
            : "application/octet-stream";
        res.setHeader("Content-Type", type);
        fs.createReadStream(full).pipe(res);
      });
    },
    generateBundle() {
      for (const dir of PDFJS_DIRS) {
        for (const file of fs.readdirSync(path.join(PDFJS_ROOT, dir))) {
          this.emitFile({
            type: "asset",
            fileName: `pdfjs/${dir}/${file}`,
            source: fs.readFileSync(path.join(PDFJS_ROOT, dir, file)),
          });
        }
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), pdfjsAssets()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
