import { useEffect } from "react";
import { bootstrap } from "./lib/actions";
import { QUESTIONS, useStore } from "./lib/store";
import { AskCostModal } from "./components/AskCostModal";
import { CaptureModal } from "./components/CaptureModal";
import { ChatList } from "./components/ChatList";
import { DragLayer } from "./components/DragLayer";
import { ImportModal, NewFolderModal } from "./components/ImportModal";
import { ItemList } from "./components/ItemList";
import { MetadataPanel } from "./components/MetadataPanel";
import { PageViewModal } from "./components/PageViewModal";
import { PdfRescueModal } from "./components/PdfRescueModal";
import { SendToHushModal } from "./components/SendToHushModal";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { Terminal } from "./components/Terminal";
import { Toolbar } from "./components/Toolbar";
import { TaskTray } from "./components/TaskTray";

function PaneResizer({ side }: { side: "left" | "right" }) {
  const { leftWidth, rightWidth, setPaneSizes } = useStore();

  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === "left" ? leftWidth : rightWidth;
    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      const w =
        side === "left"
          ? Math.min(420, Math.max(150, startW + delta))
          : Math.min(520, Math.max(200, startW - delta));
      setPaneSizes(side === "left" ? { leftWidth: w } : { rightWidth: w });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return <div className="pane-resizer" onPointerDown={start} />;
}

export default function App() {
  const view = useStore((s) => s.view);
  const modal = useStore((s) => s.modal);
  const setModal = useStore((s) => s.setModal);
  const selectedCollection = useStore((s) => s.selectedCollection);
  const { leftWidth, rightWidth } = useStore();

  useEffect(() => {
    void bootstrap();
  }, []);

  if (view === "settings") {
    return <SettingsView />;
  }

  return (
    <div className="app">
      <Toolbar />
      <div
        className="panes"
        style={
          {
            "--left-w": `${leftWidth}px`,
            "--right-w": `${rightWidth}px`,
          } as React.CSSProperties
        }
      >
        <Sidebar />
        <PaneResizer side="left" />
        {/* Questions is a folder of conversations, so it replaces the
            item list rather than filtering it. */}
        {selectedCollection === QUESTIONS ? <ChatList /> : <ItemList />}
        <PaneResizer side="right" />
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
      {modal?.kind === "pdfPage" && (
        <PageViewModal
          itemKey={modal.itemKey}
          page={modal.page}
          title={modal.title}
          quote={modal.quote}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "rescue" && (
        <PdfRescueModal jobId={modal.jobId} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "capture" && (
        <CaptureModal jobId={modal.jobId} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
