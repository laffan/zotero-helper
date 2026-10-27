import { useEffect } from "react";
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
import { WORDS } from "./lib/words";
import { ReadingModeExit } from "./components/ReadingModeExit";
import { SendToHushModal } from "./components/SendToHushModal";
import { SettingsView } from "./components/settings/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { Terminal } from "./components/Terminal";
import { Toolbar } from "./components/Toolbar";
import { TaskTray } from "./components/TaskTray";

function PaneResizer({ side }: { side: "left" | "right" }) {
  const { leftWidth, rightWidth, notesWidth, setPaneSizes, setNotesWidth } = useStore();
  const reading = useStore((s) => s.reading);

  const start = (e: React.PointerEvent) => {
    const startX = e.clientX;
    // While taking notes the right edge resizes the notes, which may
    // take up to two thirds of the window.
    const notes = side === "right" && reading !== null;
    const startW = side === "left" ? leftWidth : notes ? notesWidth : rightWidth;
    trackPointerDrag(e, (ev) => {
      const delta = ev.clientX - startX;
      if (side === "left") {
        setPaneSizes({ leftWidth: Math.min(420, Math.max(150, startW + delta)) });
      } else if (notes) {
        setNotesWidth(Math.min(window.innerWidth * 0.66, Math.max(260, startW - delta)));
      } else {
        setPaneSizes({ rightWidth: Math.min(520, Math.max(200, startW - delta)) });
      }
    });
  };

  return <div className="pane-resizer" onPointerDown={start} />;
}

export default function App() {
  const view = useStore((s) => s.view);
  const modal = useStore((s) => s.modal);
  const setModal = useStore((s) => s.setModal);
  const selectedCollection = useStore((s) => s.selectedCollection);
  const reading = useStore((s) => s.reading);
  const { leftWidth, rightWidth, notesWidth } = useStore();
  const sidebarHidden = useStore((s) => s.sidebarHidden);
  const metaHidden = useStore((s) => s.metaHidden);
  // Reading mode: the open PDF fills the window (readingmode.css).
  const readingMode = useStore((s) => s.readingMode && s.reading !== null);
  // The pane the keyboard is moving in, outlined while it is.
  const kbdPane = usePane((s) => (s.shown ? s.pane : undefined));

  useEffect(() => {
    void bootstrap();
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
