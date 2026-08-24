// The pair of buttons that starts a conversation. Placed in all three
// contexts a question can come from — an empty folder panel, the
// multi-select summary, and a single item's editor — so wherever you
// are looking at works, the two depths are the same two buttons in the
// same order.
import { startAsk } from "../lib/ai/chat";
import { useStore } from "../lib/store";
import type { ChatSource } from "../lib/types";
import { AskIcon, Spinner } from "./Icons";

interface AskButtonsProps {
  kind: ChatSource["kind"];
  /** Item keys for "item" and "selection"; ignored for a folder, whose
   *  contents are resolved when the request is made. */
  keys: string[];
  collectionKey: string;
  /** What the conversation will call its source. */
  label: string;
  /** How many works this covers, for the tooltips. */
  count: number;
}

export function AskButtons({
  kind,
  keys,
  collectionKey,
  label,
  count,
}: AskButtonsProps) {
  const preparing = useStore((s) => s.askPreparing);
  const works = count === 1 ? "this work" : `these ${count} works`;

  return (
    <div className="ask-buttons">
      <button
        className="tool-btn"
        disabled={preparing || count === 0}
        onClick={() =>
          void startAsk(kind, keys, collectionKey, label, "abstracts")
        }
        title={`Start a conversation about the abstracts of ${works}`}
      >
        {preparing ? <Spinner size={13} /> : <AskIcon size={13} />}
        Ask Abstracts
      </button>
      <button
        className="tool-btn"
        disabled={preparing || count === 0}
        onClick={() => void startAsk(kind, keys, collectionKey, label, "full")}
        title={`Read the PDFs of ${works} and start a conversation about the full text`}
      >
        {preparing ? <Spinner size={13} /> : <AskIcon size={13} />}
        Ask Full Papers
      </button>
    </div>
  );
}
