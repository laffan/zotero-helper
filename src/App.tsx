import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { bootstrap } from "./lib/actions";
import { aiConnected } from "./lib/ai/models";
import { trackPointerDrag } from "./lib/dragGesture";
import { installShortcuts } from "./lib/shortcuts/dispatch";
import { installHoverFocus } from "./lib/shortcuts/hoverFocus";
import { usePane } from "./lib/shortcuts/panes";
import { EXPLANATIONS, QUESTIONS, useStore } from "./lib/store";
import { AskCostModal } from "./components/AskCostModal";
import { CaptureModal } from "./components/CaptureModal";
import { ChatList } from "./components/ChatList";
import { DragLayer } from "./components/DragLayer";
import { ExplanationList } from "./components/ExplanationList";
import { ImportModal, NewFolderModal } from "./components/ImportModal";
import { ItemList } from "./components/ItemList";
import { MetadataPanel } from "./components/MetadataPanel";
import { PdfRescueModal } from "./components/PdfRescueModal";
import { ReaderPane } from "./components/ReaderPane";
import { WordList } from "./components/WordList";
import { startWidget } from "./lib/widget";
import { WORDS } from "./lib/words";
import { ReadingModeExit } from "./components/ReadingModeExit";
import { SendToHushModal } from "./components/SendToHushModal";
import { SettingsView } from "./components/settings/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { Terminal } from "./components/Terminal";
import { Toolbar } from "./components/Toolbar";
import { TaskTray } from "./components/TaskTray";

/** A pane edge's width (base.css's .pane-resizer). */
const RESIZER_PX = 5;
/** Up to this window width the notes keep a width of their own
 *  (notes.css): the iPad's half of the screen. */
const TABLET_PX = 900;

function PaneResizer({ side }: { side: "left" | "right" }) {
  const { leftWidth, rightWidth, notesWidth, setPaneSizes, setNotesWidth, setNotesWidthNarrow } = useStore(
    useShallow((s) => ({
      leftWidth: s.leftWidth,
      rightWidth: s.rightWidth,
      notesWidth: s.notesWidth,
      setPaneSizes: s.setPaneSizes,
      setNotesWidth: s.setNotesWidth,
      setNotesWidthNarrow: s.setNotesWidthNarrow,
    })),
  );
  const reading = useStore((s) => s.reading);

  const start = (e: React.PointerEvent) => {
    const startX = e.clientX;
    // While taking notes the right edge resizes the notes, which may
    // take the whole window but the edge itself, to drag them back by.
    const notes = side === "right" && reading !== null;
    // The notes from the width they show, which the window may hold
    // below the one kept (notes.css).
    const shown = (e.currentTarget as HTMLElement).nextElementSibling as HTMLElement | null;
    const startW = side === "left" ? leftWidth : notes ? (shown?.offsetWidth ?? notesWidth) : rightWidth;
    trackPointerDrag(e, (ev) => {
      const delta = ev.clientX - startX;
      if (side === "left") {
        setPaneSizes({ leftWidth: Math.min(420, Math.max(150, startW + delta)) });
      } else if (notes) {
        const w = Math.min(window.innerWidth - RESIZER_PX, Math.max(260, startW - delta));
        if (window.innerWidth <= TABLET_PX) setNotesWidthNarrow(w);
        else setNotesWidth(w);
      } else {
        setPaneSizes({ rightWidth: Math.min(520, Math.max(200, startW - delta)) });
      }
    }, undefined, { resizesPanes: true });
  };

  // The notes' edge stays on a tablet-sized window (600–900px — the
  // iPad's half of the screen), where the panels are otherwise drawers.
  const cls = side === "right" && reading !== null ? "pane-resizer notes-edge" : "pane-resizer";
  return <div className={cls} onPointerDown={start} />;
}

export default function App() {
  const view = useStore((s) => s.view);
  const modal = useStore((s) => s.modal);
  const setModal = useStore((s) => s.setModal);
  const selectedCollection = useStore((s) => s.selectedCollection);
  const reading = useStore((s) => s.reading);
  const { leftWidth, rightWidth, notesWidth, notesWidthNarrow } = useStore(
    useShallow((s) => ({
      leftWidth: s.leftWidth,
      rightWidth: s.rightWidth,
      notesWidth: s.notesWidth,
      notesWidthNarrow: s.notesWidthNarrow,
    })),
  );
  const sidebarHidden = useStore((s) => s.sidebarHidden);
  const metaHidden = useStore((s) => s.metaHidden);
  // Reading mode: the open PDF fills the window (readingmode.css).
  const readingMode = useStore((s) => s.readingMode && s.reading !== null);
  // The pane the keyboard is moving in, outlined while it is.
  const kbdPane = usePane((s) => (s.shown ? s.pane : undefined));

  useEffect(() => {
    // The home-screen widget, once the library it names is loaded (iOS).
    void bootstrap().then(startWidget);
    installShortcuts();
    installHoverFocus();
  }, []);

  // Questions is an AI feature: with no service connected it isn't in
  // the sidebar, so a remembered visit to it falls back to All Items.
  const settings = useStore((s) => s.settings);
  useEffect(() => {
    if (settings && !aiConnected(settings) && selectedCollection === QUESTIONS) {
      useStore.getState().selectCollection("all");
    }
  }, [settings, selectedCollection]);

  return (
    <>
      <div className={readingMode ? "app reading-mode" : "app"}>
        {readingMode && <ReadingModeExit />}
        <Toolbar />
        <div
          className="panes"
          data-kbd-pane={reading ? undefined : kbdPane}
          style={
            {
              "--left-w": `${leftWidth}px`,
              "--right-w": `${rightWidth}px`,
              "--notes-w": `${notesWidth}px`,
              ...(notesWidthNarrow ? { "--notes-w-narrow": `${notesWidthNarrow}px` } : {}),
            } as React.CSSProperties
          }
        >
          {reading ? (
            // An open PDF takes the sidebar's and the list's room.
            <ReaderPane />
          ) : (
            <>
              <Sidebar />
              {!sidebarHidden && <PaneResizer side="left" />}
              {/* Questions is a folder of conversations, so it replaces
                  the item list rather than filtering it. */}
              {selectedCollection === QUESTIONS ? (
                <ChatList />
              ) : selectedCollection === EXPLANATIONS ? (
                <ExplanationList />
              ) : selectedCollection === WORDS ? (
                <WordList />
              ) : (
                <ItemList />
              )}
            </>
          )}
          {!metaHidden && <PaneResizer side="right" />}
          <MetadataPanel />
        </div>
        <Terminal />
        <TaskTray />
        <DragLayer />

        {modal?.kind === "import" && <ImportModal onClose={() => setModal(null)} />}
        {modal?.kind === "newFolder" && (
          <NewFolderModal onClose={() => setModal(null)} />
        )}
        {modal?.kind === "sendToHush" && (
          <SendToHushModal onClose={() => setModal(null)} />
        )}
        {modal?.kind === "askCost" && (
          <AskCostModal
            onClose={() => {
              useStore.getState().setPendingAsk(null);
              setModal(null);
            }}
          />
        )}
        {modal?.kind === "rescue" && (
          <PdfRescueModal jobId={modal.jobId} onClose={() => setModal(null)} />
        )}
        {modal?.kind === "capture" && (
          <CaptureModal jobId={modal.jobId} onClose={() => setModal(null)} />
        )}
      </div>
      {/* Over the app, not instead of it: the library (or the open PDF)
          stays where it was underneath. */}
      {view === "settings" && <SettingsView />}
    </>
  );
}
