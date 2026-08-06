import { useEffect } from "react";
import { bootstrap } from "./lib/actions";
import { useStore } from "./lib/store";
import { ImportModal, NewFolderModal } from "./components/ImportModal";
import { ItemList } from "./components/ItemList";
import { MetadataPanel } from "./components/MetadataPanel";
import { PdfRescueModal } from "./components/PdfRescueModal";
import { SendToHushModal } from "./components/SendToHushModal";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { Terminal } from "./components/Terminal";
import { Toolbar } from "./components/Toolbar";

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
        <ItemList />
        <PaneResizer side="right" />
        <MetadataPanel />
      </div>
      <Terminal />

      {modal?.kind === "import" && <ImportModal onClose={() => setModal(null)} />}
      {modal?.kind === "newFolder" && (
        <NewFolderModal onClose={() => setModal(null)} />
      )}
      {modal?.kind === "sendToHush" && (
        <SendToHushModal onClose={() => setModal(null)} />
      )}
      {modal?.kind === "rescue" && (
        <PdfRescueModal jobId={modal.jobId} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
