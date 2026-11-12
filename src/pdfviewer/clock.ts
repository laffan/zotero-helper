// The clock beside the reader's place — "25% | 8 of 32 | 1:33pm", in the
// bottom bar and in reading mode's pill — and the reading timer it turns
// into. A press on the clock opens a small card to start a timer, for a
// span (hours and minutes) or until a time of day; while it runs, the
// clock's place counts down ("24:59") and a press opens the card again,
// to cancel it. At zero the count stays at 0:00, in red, until pressed,
// which puts the clock back (or for ten minutes, if nobody does).
//
// One timer for the app, kept on this device (`zh-reading-timer`, its
// end): it lives through switching PDFs and closing the app, and every
// clock shows it. One ticker updates every clock — each second while a
// timer runs, else as each minute turns — and only while one is shown.
//
// The card sits in the upper part of the window, not over the clock at
// the bottom, where the iPad's keyboard would cover it.
const KEY = "zh-reading-timer";
const LAST_KEY = "zh-reading-timer-last";
/** How long a finished timer waits to be acknowledged. */
const DONE_FOR_MS = 10 * 60_000;

type Mode = "for" | "until";
interface Last {
  mode: Mode;
  h: number;
  m: number;
}

function read<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown): void {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

let endsAt: number | null = read<number | null>(KEY, null);
const slots = new Set<HTMLButtonElement>();
let ticker = 0;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "1:33pm". */
export function clockText(d = new Date()): string {
  const h = d.getHours();
  return `${h % 12 || 12}:${pad2(d.getMinutes())}${h < 12 ? "am" : "pm"}`;
}

/** "24:59", "1:05:00". */
function countText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
}

function setEnd(at: number | null): void {
  endsAt = at;
  write(KEY, at);
  tick();
}

/** Paint every clock, and wake again when its text next changes. */
function tick(): void {
  window.clearTimeout(ticker);
  const now = Date.now();
  if (endsAt !== null && now - endsAt > DONE_FOR_MS) {
    endsAt = null;
    write(KEY, null);
  }
  const state = endsAt === null ? "clock" : now < endsAt ? "running" : "done";
  const text = state === "clock" ? clockText() : countText(endsAt! - now);
  const title =
    state === "clock" ? "Start a timer" : state === "running" ? `Timer — until ${clockText(new Date(endsAt!))}` : "Time’s up";
  for (const s of slots) {
    if (s.textContent !== text) s.textContent = text;
    s.dataset.state = state;
    s.title = title;
  }
  if (!slots.size) return;
  const wait = state === "running" ? ((endsAt! - now) % 1000 || 1000) + 5 : 60_000 - (now % 60_000) + 20;
  ticker = window.setTimeout(tick, wait);
}

// --- the card ---------------------------------------------------------------

let card: { el: HTMLElement; close: () => void } | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function numberInput(value: number, label: string): HTMLInputElement {
  const i = el("input", "pdf-timer-num");
  i.inputMode = "numeric";
  i.maxLength = 3;
  i.value = String(value);
  i.setAttribute("aria-label", label);
  i.addEventListener("input", () => (i.value = i.value.replace(/\D/g, "")));
  return i;
}

/** The time of day `minutes` from now, rounded up to five, as an
 *  <input type="time"> value. */
function soon(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** The start form: for hours and minutes, or until a time. */
function startForm(done: () => void): HTMLElement {
  const last = read<Last>(LAST_KEY, { mode: "for", h: 0, m: 25 });
  let mode: Mode = last.mode === "until" ? "until" : "for";
  const form = el("form", "pdf-timer-form");
  const modes = el("div", "pdf-timer-modes");
  const forBtn = el("button", "", "For");
  const untilBtn = el("button", "", "Until");
  forBtn.type = untilBtn.type = "button";
  modes.append(forBtn, untilBtn);
  const h = numberInput(last.h, "Hours");
  const m = numberInput(last.m, "Minutes");
  const span = el("div", "pdf-timer-row");
  span.append(h, el("span", "pdf-timer-unit", "h"), m, el("span", "pdf-timer-unit", "m"));
  const at = el("input", "pdf-timer-time");
  at.type = "time";
  at.value = soon(30);
  at.setAttribute("aria-label", "Until");
  const until = el("div", "pdf-timer-row");
  until.append(at);
  const start = el("button", "pdf-timer-go", "Start");
  start.type = "submit";
  const show = (next: Mode) => {
    mode = next;
    forBtn.classList.toggle("on", mode === "for");
    untilBtn.classList.toggle("on", mode === "until");
    span.hidden = mode !== "for";
    until.hidden = mode !== "until";
  };
  forBtn.addEventListener("click", () => show("for"));
  untilBtn.addEventListener("click", () => show("until"));
  show(mode);
  form.append(modes, span, until, start);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    let end: number;
    if (mode === "for") {
      const mins = (Number(h.value) || 0) * 60 + (Number(m.value) || 0);
      if (mins <= 0) return;
      end = Date.now() + mins * 60_000;
      write(LAST_KEY, { mode, h: Number(h.value) || 0, m: Number(m.value) || 0 });
    } else {
      const [hh, mm] = at.value.split(":").map(Number);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return;
      const d = new Date();
      d.setHours(hh, mm, 0, 0);
      // A time already past today is tomorrow's.
      end = d.getTime() <= Date.now() ? d.getTime() + 86_400_000 : d.getTime();
      write(LAST_KEY, { ...last, mode });
    }
    setEnd(end);
    done();
  });
  return form;
}

/** The running timer: when it ends, and Cancel. */
function runningView(done: () => void): HTMLElement {
  const box = el("div", "pdf-timer-running");
  box.append(el("div", "pdf-timer-until", `Until ${clockText(new Date(endsAt!))}`));
  const cancel = el("button", "pdf-timer-cancel", "Cancel timer");
  cancel.type = "button";
  cancel.addEventListener("click", () => {
    setEnd(null);
    done();
  });
  box.append(cancel);
  return box;
}

function openCard(): void {
  card?.close();
  // At zero, a press acknowledges it: the clock comes back.
  if (endsAt !== null && Date.now() >= endsAt) return setEnd(null);
  const backdrop = el("div", "pdf-timer-backdrop");
  const box = el("div", "pdf-timer-card");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Timer");
  const close = () => {
    backdrop.remove();
    window.removeEventListener("keydown", onKey, true);
    card = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    // Before reading mode's own Escape.
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  box.append(endsAt === null ? startForm(close) : runningView(close));
  backdrop.append(box);
  // On the click, not the press, so the tap ends on the backdrop rather
  // than on whatever is under it once the card has gone.
  backdrop.addEventListener("click", (e) => e.target === backdrop && close());
  window.addEventListener("keydown", onKey, true);
  document.body.appendChild(backdrop);
  card = { el: backdrop, close };
}

/** A clock (or the timer, while one runs) for a place beside the
 *  reader's page; `remove` takes it away. */
export function createClock(): { el: HTMLButtonElement; remove: () => void } {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pdf-clock";
  b.addEventListener("click", openCard);
  slots.add(b);
  tick();
  return {
    el: b,
    remove(): void {
      slots.delete(b);
      b.remove();
      if (!slots.size) {
        window.clearTimeout(ticker);
        card?.close();
      }
    },
  };
}
