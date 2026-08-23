// The thing that follows the pointer while items are being dragged onto
// a folder. Rendered once at the app root; invisible until a drag starts.
import { useDrag } from "../lib/dragdrop";
import { Folder } from "./Icons";

export function DragLayer() {
  const { keys, label, x, y, over } = useDrag();
  if (keys.length === 0) return null;

  return (
    <div
      className={`drag-ghost ${over ? "over" : ""}`}
      style={{ transform: `translate3d(${x + 14}px, ${y + 14}px, 0)` }}
    >
      {keys.length > 1 && <span className="drag-count">{keys.length}</span>}
      <span className="drag-label">{label}</span>
      {over && (
        <span className="drag-dest">
          <Folder size={12} />
          {over.name}
        </span>
      )}
    </div>
  );
}
