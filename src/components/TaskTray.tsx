// Minimal floating progress tray for batched work (AI actions, Share
// staging): one line per item, queued → working → done/error. The
// import pipeline has its own richer in-list rows; this covers
// everything else that used to be visible only in the terminal.
import { useStore } from "../lib/store";
import { CheckIcon, CloseIcon, Spinner } from "./Icons";

const MAX_LINES = 7;

export function TaskTray() {
  const tasks = useStore((s) => s.uiTasks);
  const label = useStore((s) => s.uiTaskLabel);
  if (tasks.length === 0) return null;

  const settled = tasks.filter(
    (t) => t.status === "done" || t.status === "error",
  ).length;
  // Show the active window of the list: working item first, then queue.
  const firstBusy = tasks.findIndex(
    (t) => t.status === "working" || t.status === "queued",
  );
  const start = Math.max(
    0,
    Math.min(firstBusy < 0 ? tasks.length - MAX_LINES : firstBusy - 1,
      tasks.length - MAX_LINES),
  );
  const visible = tasks.slice(start, start + MAX_LINES);

  return (
    <div className="task-tray">
      <div className="task-tray-head">
        <span>{label}</span>
        <span className="task-tray-count">
          {settled}/{tasks.length}
        </span>
      </div>
      {start > 0 && (
        <div className="task-line task-more">{start} done earlier</div>
      )}
      {visible.map((t) => (
        <div key={t.id} className={`task-line task-${t.status}`}>
          {t.status === "working" ? (
            <Spinner size={11} />
          ) : t.status === "done" ? (
            <CheckIcon size={11} />
          ) : t.status === "error" ? (
            <CloseIcon size={11} />
          ) : (
            <span className="task-dot" />
          )}
          <span className="task-title" title={t.title}>
            {t.title}
          </span>
          {t.note && (
            <span className="task-note" title={t.note}>
              {t.note}
            </span>
          )}
        </div>
      ))}
      {start + MAX_LINES < tasks.length && (
        <div className="task-line task-more">
          +{tasks.length - start - MAX_LINES} queued
        </div>
      )}
    </div>
  );
}

/** Clear the tray a beat after a batch settles — unless a new batch has
 *  already started. */
export function scheduleTrayClear(delayMs = 4000): void {
  setTimeout(() => {
    const { uiTasks, clearUiTasks } = useStore.getState();
    if (
      uiTasks.length > 0 &&
      uiTasks.every((t) => t.status === "done" || t.status === "error")
    ) {
      clearUiTasks();
    }
  }, delayMs);
}
