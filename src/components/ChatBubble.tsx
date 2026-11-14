// An answer or a question in a conversation (ChatPanel.tsx), an
// explainer (ExplainChat.tsx) or one of their clarifications
// (ThreadStrip.tsx): the question as typed, the answer as Markdown with
// its citations as pills — and, where passages of it have been asked
// about, those passages marked (lib/ai/threadMarks.ts).
import { memo, useMemo } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openInZotero } from "../lib/actions";
import {
  CITE_SCHEME,
  citationLabel,
  linkifyCitations,
  parseCiteHref,
} from "../lib/ai/citations";
import { rehypeThreadMarks, type ThreadMark } from "../lib/ai/threadMarks";
import { firstAuthorLast, pdfAttachmentOf } from "../lib/collections";
import { useStore } from "../lib/store";
import type { ChatSource } from "../lib/types";
import { ExternalIcon, EyeIcon } from "./Icons";
import { openReaderAt } from "./ReaderPane";

/** The button a [[cite:W:P]] becomes: which page, and the two ways to
 *  go and look at it. */
function CitePill({
  href,
  source,
}: {
  href: string;
  source: ChatSource;
}) {
  const items = useStore((s) => s.library.items);
  const cite = parseCiteHref(href);
  if (!cite) return null;

  // A citation that named only a page is unambiguous when the chat
  // covers a single work, and guesswork when it doesn't.
  const index =
    cite.work ?? (source.itemKeys.length === 1 ? 1 : 0);
  const itemKey = source.itemKeys[index - 1];
  const title = source.itemTitles?.[index - 1] ?? "";
  const label = citationLabel(cite);

  // Which paper this came from, when there is more than one it could
  // have come from. A page number on its own is only ever unambiguous
  // in a chat about a single work; across a folder, "p. 3" three times
  // in a paragraph is three different papers.
  const item = itemKey ? items.find((i) => i.key === itemKey) : undefined;
  const who = source.itemKeys.length > 1 && item ? firstAuthorLast(item) : "";

  // No work to resolve, or the work has no PDF any more: keep the
  // reference visible, just without buttons that would go nowhere.
  const att = itemKey ? pdfAttachmentOf(items, itemKey) : undefined;
  if (!itemKey || !att) {
    return (
      <span className="cite-pill cite-pill-dead" title={title || undefined}>
        {who && <span className="cite-who">{who}</span>}
        {label}
      </span>
    );
  }

  return (
    <span className="cite-pill" title={title || undefined}>
      {who && <span className="cite-who">{who}</span>}
      <span className="cite-label">{label}</span>
      <button
        onClick={() => openReaderAt(itemKey, att.key, cite.page, { quote: cite.quote, tab: "chats" })}
        aria-label={`Show page ${cite.page} in the PDF`}
        title={
          cite.quote
            ? `Open the PDF at page ${cite.page}, with the passage highlighted:\n“${cite.quote}”`
            : `Open the PDF at page ${cite.page}${title ? ` — ${title}` : ""}`
        }
      >
        <EyeIcon size={12} />
      </button>
      <button
        onClick={() =>
          void openInZotero(itemKey, att.key, undefined, cite.page)
        }
        aria-label={`Open page ${cite.page} in Zotero`}
        title={`Open in Zotero at page ${cite.page}`}
      >
        <ExternalIcon size={12} />
      </button>
    </span>
  );
}

/** Who said it is carried by the styling — the question sits in a box,
 *  the answer runs plain down the panel.
 *
 *  Answers render as Markdown (GitHub flavour, so tables and strike-
 *  through work): models write headings, lists and tables whether or not
 *  you ask, and a comparison of five papers is a table. The question is
 *  left as typed — nobody writes Markdown into a chat box on purpose,
 *  and an underscore in a title shouldn't turn into emphasis.
 *
 *  `marks`: the passages of an answer asked about (its clarifications),
 *  marked as it renders. Pass the same array while they are the same:
 *  a new one renders the answer again, which lets go of a selection in
 *  it. */
export const Bubble = memo(function Bubble({
  role,
  content,
  source,
  marks,
}: {
  role: string;
  content: string;
  source: ChatSource;
  marks?: ThreadMark[];
}) {
  // Citations become links with a private scheme so the Markdown
  // pipeline carries them as real nodes, and the `a` override below
  // turns those back into pills.
  const md = useMemo(
    () => (role === "user" ? content : linkifyCitations(content)),
    [role, content],
  );
  const rehype = useMemo(
    () => (marks?.length ? [[rehypeThreadMarks, { marks }] as [typeof rehypeThreadMarks, { marks: ThreadMark[] }]] : []),
    [marks],
  );
  return (
    <div className={`chat-msg chat-msg-${role}`}>
      {role === "user" ? (
        <div className="chat-msg-body">{content}</div>
      ) : (
        <div className="chat-msg-body chat-md">
          <Markdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={rehype}
            // react-markdown drops any URL whose scheme it doesn't
            // recognise, which would strip citations before they reach
            // the `a` override below. Let ours through and leave every
            // other link to the default sanitizer — the text is a
            // model's, so `javascript:` still has to be blocked.
            urlTransform={(url) =>
              url.startsWith(CITE_SCHEME) ? url : defaultUrlTransform(url)
            }
            components={{
              // The panel is a narrow column; a wide table scrolls
              // inside its own box rather than stretching it.
              table: ({ children }) => (
                <div className="chat-md-table">
                  <table>{children}</table>
                </div>
              ),
              a: ({ href, children }) =>
                parseCiteHref(String(href ?? "")) ? (
                  <CitePill href={String(href)} source={source} />
                ) : (
                  <a href={href} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                ),
            }}
          >
            {md}
          </Markdown>
        </div>
      )}
    </div>
  );
});
