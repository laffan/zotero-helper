// "View Titles" — the works a conversation covers, folded away.
//
// A folder chat can cover thirty of them, so the list is closed until
// asked for. Each work offers both places it lives: the title selects it
// here, in the folder the question was asked from, and the icon beside
// it hands the same entry to Zotero.
import { openInZotero } from "../lib/actions";
import { useStore } from "../lib/store";
import type { ChatSource } from "../lib/types";
import { ExternalIcon } from "./Icons";

export function WorkTitles({ source }: { source: ChatSource }) {
  const selectCollection = useStore((s) => s.selectCollection);
  const setSelectedKeys = useStore((s) => s.setSelectedKeys);
  const titles = source.itemTitles ?? [];
  if (titles.length === 0) return null;

  /** Show the entry in this app, in the folder it was asked about —
   *  the same context Zotero gets, for an item filed in several. */
  const reveal = (itemKey: string) => {
    selectCollection(source.collectionKey ?? "all");
    setSelectedKeys([itemKey]);
  };

  return (
    <details className="work-titles" onClick={(e) => e.stopPropagation()}>
      <summary>View Titles ({titles.length})</summary>
      <ol>
        {titles.map((t, i) => {
          const itemKey = source.itemKeys[i];
          return (
            <li key={`${i}-${t}`}>
              <button
                className="link-btn"
                onClick={() => reveal(itemKey)}
                title={
                  source.collectionKey
                    ? `Show in “${source.label}”`
                    : "Show in the library"
                }
              >
                {t}
              </button>
              <button
                className="work-titles-zotero"
                onClick={() =>
                  void openInZotero(itemKey, undefined, source.collectionKey)
                }
                aria-label={`Open “${t}” in Zotero`}
                title={
                  source.collectionKey
                    ? `Open in Zotero, in “${source.label}”`
                    : "Open in Zotero"
                }
              >
                <ExternalIcon size={11} />
              </button>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
