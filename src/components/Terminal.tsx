import { useEffect, useRef, useState } from "react";
import { appLog, useStore } from "../lib/store";
import { CloseIcon, CopyIcon } from "./Icons";

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function Terminal() {
  const logs = useStore((s) => s.logs);
  const { logOpen, setLogOpen, clearLogs, termHeight, setPaneSizes } = useStore();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (pinned && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [logs, pinned, logOpen]);

  if (!logOpen) return null;

  const copyAll = async () => {
    const text = logs
      .map((l) => `${fmtTime(l.ts)} [${l.level.toUpperCase()}] ${l.message}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // WebView clipboard fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      appLog("debug", "Copied log via fallback path");
    }
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = termHeight;
    const onMove = (ev: PointerEvent) => {
      const h = Math.min(500, Math.max(80, startH + (startY - ev.clientY)));
      setPaneSizes({ termHeight: h });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="terminal" style={{ height: termHeight }}>
      <div className="terminal-grip" onPointerDown={startResize} />
      <div className="terminal-header">
        <span className="terminal-title">Activity log</span>
        <label className="terminal-pin">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
          />
          follow
        </label>
        <button className="mini-btn" onClick={copyAll}>
          <CopyIcon size={12} /> {copied ? "Copied!" : "Copy"}
        </button>
        <button className="mini-btn" onClick={clearLogs}>
          Clear
        </button>
        <button
          className="icon-btn"
          onClick={() => setLogOpen(false)}
          aria-label="Close log"
        >
          <CloseIcon size={12} />
        </button>
      </div>
      <div className="terminal-body" ref={bodyRef}>
        {logs.length === 0 && <div className="terminal-line dim">— log is empty —</div>}
        {logs.map((l, i) => (
          <div className={`terminal-line lvl-${l.level}`} key={i}>
            <span className="terminal-ts">{fmtTime(l.ts)}</span>
            <span className="terminal-lvl">[{l.level.toUpperCase()}]</span>{" "}
            {l.message}
          </div>
        ))}
      </div>
    </div>
  );
}
