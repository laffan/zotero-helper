// The pen at work, wherever it writes — the pages' ink mode
// (src/pdfviewer/ink/input.ts) and the notepad (src/notepad/surface.ts)
// — as one signal for the work that would cost a stroke its samples if
// it ran now: page renders and their text layers, the notepad's save and
// minimap, the annotation push.
//
// Handwriting is strokes a fifth of a second apart, in words a few
// tenths of a second apart. "The pen is up" is therefore not a pause:
// work started the moment it lifts lands on the start of the next
// stroke, and on the iPad the samples WebKit could not deliver meanwhile
// are lost, not late. So what waits asks how long the pen has rested
// (`penRested`), and each kind of work picks the rest it needs: a page
// with nothing on it yet waits for a short one, everything else for the
// pause at the end of a thought.
//
// A gesture whose end was lost still lets go: the pen counts as down
// only while its gesture has been heard from in the last STALE_MS (the
// gestures themselves end such a one at the next press, as before).
const STALE_MS = 1500;
/** The pause at the end of a thought, ms: work that can wait for the
 *  writing to stop waits this long after the pen's last stroke. */
export const WRITING_PAUSE_MS = 1800;

// Who has a gesture open (the viewer's ink, a notepad view): each ends
// only its own, so a finger on the pad can't end the Pencil's stroke on
// the pages.
const holders = new Set<object>();
let heardAt = -Infinity;
let upAt = -Infinity;

/** A pen gesture began (the Pencil, or a mouse writing on the pad) in
 *  `who` — the view it began in. */
export function penDown(who: object): void {
  holders.add(who);
  heardAt = performance.now();
}

/** The gesture is still going (a move) — `now` when the caller has it. */
export function penHeard(now = performance.now()): void {
  heardAt = now;
}

/** `who`'s gesture ended (a no-op if it had none). */
export function penUp(who: object): void {
  if (!holders.delete(who)) return;
  upAt = performance.now();
}

/** How long the pen has rested, ms: 0 while it is down, Infinity if it
 *  has never written. A gesture gone quiet counts from its last word. */
export function penRestedMs(): number {
  if (!holders.size) return performance.now() - upAt;
  const since = performance.now() - heardAt;
  return since < STALE_MS ? 0 : since - STALE_MS;
}

/** Has the pen rested at least `ms`? */
export const penRested = (ms: number): boolean => penRestedMs() >= ms;

/** Run `fn` once the pen has rested `ms` — now, if it has. Returns a
 *  cancel. */
export function whenPenRested(ms: number, fn: () => void): () => void {
  let timer = 0;
  const check = () => {
    const rest = penRestedMs();
    if (rest >= ms) {
      timer = 0;
      fn();
    } else timer = window.setTimeout(check, Math.max(16, ms - rest));
  };
  check();
  return () => window.clearTimeout(timer);
}
