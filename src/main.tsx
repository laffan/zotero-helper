import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initAppearance } from "./lib/appearance";
import "./styles/index.css";

// iPadOS reports a desktop-class ("Macintosh") user agent — multitouch
// is the tell. The .ipados class drives windowed-mode padding fixes.
if (
  typeof navigator !== "undefined" &&
  navigator.maxTouchPoints > 1 &&
  /Mac|iPad/.test(navigator.userAgent)
) {
  document.documentElement.classList.add("ipados");
}

// The app never zooms as a whole — a pinch over a PDF's pages magnifies
// just them (pdfviewer/magnify.ts), and anywhere else does nothing.
// WebKit (the iPad, the Mac app) pinches by its gesture events; the
// viewport's user-scalable=no covers the rest.
document.addEventListener("gesturestart", (e) => e.preventDefault());

initAppearance();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
