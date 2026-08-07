import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
