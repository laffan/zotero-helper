// The clock beside the reader's place — "25% | 8 of 32 | 1:33pm", in the
// bottom bar and in reading mode's pill — and the reading timer it turns
// into. A press on the clock opens a little window over it, its arrow
// pointing down at it, to start a timer: for a span (hours and minutes)
// or until a time of day. While it runs, the clock's place counts down
// ("24:59"), and a press opens the window again — when it ends, and
// Cancel Timer. A press outside, Escape or the clock again closes it.
//
// At zero a modal in the middle of the window says so ("Time’s up"), and
// its OK puts the clock back; until then the count shows 0:00 in red. The
// end is its own timeout, apart from the clocks, so the alert comes with
// no PDF open too — and a timer that ended while the app was put away is
// announced as it comes back (late timeouts fire at once).
//
// One timer for the app, kept on this device (`zh-reading-timer`): it
// lives through switching PDFs and closing the app, and every clock
// shows it. One ticker updates every clock — each second while a timer
// runs, else as each minute turns — and only while one is shown.
//
// The window sits over the clock at the bottom of the screen, where the
// iPad's keyboard comes up: while it covers the window (the visual
// viewport ends above it), the window moves up out of its way.
const KEY = "zh-reading-timer";
const LAST_KEY = "zh-reading-timer-last";

type Mode = "for" | "until";
interface Last {
  mode: Mode;
  h: number;
  m: number;
}
/** A timer: when it ends, and what it was ("25 min", "until 1:33pm"). */
interface Timer {
  endsAt: number;
  label: string;
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

/** The stored timer — a bare end time, as first kept, read as one. */
function stored(): Timer | null {
  const v = read<Timer | number | null>(KEY, null);
  if (typeof v === "number") return { endsAt: v, label: "" };
  return v && typeof v.endsAt === "number" ? v : null;
}

let timer: Timer | null = stored();
const slots = new Set<HTMLButtonElement>();
let ticker = 0;
let ending = 0;

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

/** "25 min", "1 h", "1 h 30 min". */
function spanText(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
}

function setTimer(t: Timer | null): void {
  timer = t;
  write(KEY, t);
  armEnd();
  tick();
}

/** The end's own timeout, whatever clocks there are. */
function armEnd(): void {
  window.clearTimeout(ending);
  if (timer) ending = window.setTimeout(() => (tick(), showDone()), Math.max(0, timer.endsAt - Date.now()) + 20);
}

type State = "clock" | "running" | "done";
const stateNow = (): State => (!timer ? "clock" : Date.now() < timer.endsAt ? "running" : "done");

/** Paint every clock, and wake again when its text next changes. */
function tick(): void {
  window.clearTimeout(ticker);
  const now = Date.now();
  const state = stateNow();
  const text = state === "clock" ? clockText() : countText(timer!.endsAt - now);
  const title =
    state === "clock" ? "Start a timer" : state === "running" ? `Timer — until ${clockText(new Date(timer!.endsAt))}` : "Time’s up";
  for (const s of slots) {
    if (s.textContent !== text) s.textContent = text;
    s.dataset.state = state;
    s.title = title;
  }
  if (!slots.size) return;
  const wait = state === "running" ? ((timer!.endsAt - now) % 1000 || 1000) + 5 : 60_000 - (now % 60_000) + 20;
  ticker = window.setTimeout(tick, wait);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

// --- the window over the clock ----------------------------------------------

let pop: { el: HTMLElement; anchor: HTMLElement; close: () => void } | null = null;

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
    placePop();
  };
  forBtn.addEventListener("click", () => show("for"));
  untilBtn.addEventListener("click", () => show("until"));
  form.append(modes, span, until, start);
  show(mode);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (mode === "for") {
      const mins = (Number(h.value) || 0) * 60 + (Number(m.value) || 0);
      if (mins <= 0) return;
      write(LAST_KEY, { mode, h: Number(h.value) || 0, m: Number(m.value) || 0 });
      setTimer({ endsAt: Date.now() + mins * 60_000, label: spanText(mins) });
    } else {
      const [hh, mm] = at.value.split(":").map(Number);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return;
      const d = new Date();
      d.setHours(hh, mm, 0, 0);
      // A time already past today is tomorrow's.
      const end = d.getTime() <= Date.now() ? d.getTime() + 86_400_000 : d.getTime();
      write(LAST_KEY, { ...last, mode });
      setTimer({ endsAt: end, label: `until ${clockText(new Date(end))}` });
    }
    done();
  });
  return form;
}

/** The running timer: when it ends, and Cancel. */
function runningView(done: () => void): HTMLElement {
  const box = el("div", "pdf-timer-running");
  box.append(el("div", "pdf-timer-until", `Until ${clockText(new Date(timer!.endsAt))}`));
  const cancel = el("button", "pdf-timer-cancel", "Cancel timer");
  cancel.type = "button";
  cancel.addEventListener("click", () => {
    setTimer(null);
    done();
  });
  box.append(cancel);
  return box;
}

/** Over the clock, the arrow at its middle, kept inside the window —
 *  and above the iPad's keyboard while it is up. */
function placePop(): void {
  if (!pop) return;
  const { el: box, anchor } = pop;
  if (!anchor.isConnected || !anchor.getClientRects().length) return pop.close();
  const a = anchor.getBoundingClientRect();
  const w = box.offsetWidth;
  const mid = a.left + a.width / 2;
  const left = Math.max(8, Math.min(mid - w / 2, window.innerWidth - w - 8));
  box.style.left = `${left}px`;
  box.style.setProperty("--arrow-x", `${Math.max(14, Math.min(mid - left, w - 14))}px`);
  let top = a.top - 10 - box.offsetHeight;
  const vv = window.visualViewport;
  const floor = vv ? vv.offsetTop + vv.height - 8 : window.innerHeight;
  const covered = top + box.offsetHeight > floor;
  if (covered) top = floor - box.offsetHeight;
  box.style.top = `${Math.max(8, top)}px`;
  // The arrow points at the clock only while the window is over it.
  box.classList.toggle("lifted", covered);
}

function closePop(): void {
  pop?.close();
}

function openPop(anchor: HTMLElement): void {
  closePop();
  const box = el("div", "pdf-timer-pop");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Timer");
  box.append(el("span", "pdf-timer-arrow"));
  const onOutside = (e: PointerEvent) => {
    const t = e.target as Element;
    // The clock's own press toggles the window (its click).
    if (!box.contains(t) && !t.closest?.(".pdf-clock")) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    // Before reading mode's own Escape.
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  const close = () => {
    box.remove();
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", placePop);
    window.visualViewport?.removeEventListener("resize", placePop);
    window.visualViewport?.removeEventListener("scroll", placePop);
    if (pop?.el === box) pop = null;
  };
  pop = { el: box, anchor, close };
  box.append(timer ? runningView(close) : startForm(close));
  document.body.appendChild(box);
  placePop();
  document.addEventListener("pointerdown", onOutside, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", placePop);
  window.visualViewport?.addEventListener("resize", placePop);
  window.visualViewport?.addEventListener("scroll", placePop);
}

// --- the alert at zero --------------------------------------------------------

let alertBox: HTMLElement | null = null;

/** "Time’s up", in the middle of the window; OK puts the clock back. */
function showDone(): void {
  if (alertBox || stateNow() !== "done") return;
  closePop();
  const t = timer!;
  const backdrop = el("div", "pdf-timer-backdrop");
  const box = el("div", "pdf-timer-alert");
  box.setAttribute("role", "alertdialog");
  box.setAttribute("aria-label", "Time’s up");
  box.append(
    el("div", "pdf-timer-alert-title", "Time’s up"),
    el("div", "pdf-timer-alert-detail", [t.label, `ended ${clockText(new Date(t.endsAt))}`].filter(Boolean).join(" · ")),
  );
  const ok = el("button", "pdf-timer-go", "OK");
  ok.type = "button";
  box.append(ok);
  backdrop.append(box);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" && e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    dismiss();
  };
  const dismiss = () => {
    backdrop.remove();
    window.removeEventListener("keydown", onKey, true);
    alertBox = null;
    setTimer(null);
  };
  ok.addEventListener("click", dismiss);
  // On the click, so the tap ends on the backdrop, not what is under it.
  backdrop.addEventListener("click", (e) => e.target === backdrop && dismiss());
  window.addEventListener("keydown", onKey, true);
  document.body.appendChild(backdrop);
  alertBox = backdrop;
}

/** A clock (or the timer, while one runs) for a place beside the
 *  reader's page; `remove` takes it away. */
export function createClock(): { el: HTMLButtonElement; remove: () => void } {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pdf-clock";
  b.addEventListener("click", () => {
    if (pop?.anchor === b) return closePop();
    // At zero, the press brings the alert back (its OK clears it).
    if (stateNow() === "done") return showDone();
    openPop(b);
  });
  slots.add(b);
  tick();
  return {
    el: b,
    remove(): void {
      slots.delete(b);
      b.remove();
      if (pop?.anchor === b) closePop();
      if (!slots.size) window.clearTimeout(ticker);
    },
  };
}

// A timer kept from before (another PDF, the app closed): its end is
// armed as this loads, and one already past is announced.
armEnd();
