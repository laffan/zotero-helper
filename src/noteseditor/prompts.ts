// The reading questions: what an empty note offers to start from
// (NotesPrompts.tsx shows them where the notes would be), and what a
// line begun with "?" offers to insert — each as a level-3 heading.
import { autocompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

/** Two groups: reading the work, then weighing it. */
export const PROMPT_GROUPS: string[][] = [
  [
    "Who is the author?",
    "What are their arguments?",
    "What is the evidence to support these?",
    "What are their conclusions?",
  ],
  [
    "What are the weaknesses of the arguments, evidence and conclusions?",
    "What do you think of the arguments, evidence and conclusions?",
    "How does (or how could) the author respond to these criticisms?",
  ],
];

export const PROMPTS = PROMPT_GROUPS.flat();

export const heading = (prompt: string) => `### ${prompt}`;

/** "Use": every question as a heading, a line to write on under each. */
export function allPromptsMarkdown(): { text: string; caret: number } {
  const first = heading(PROMPTS[0]);
  return { text: PROMPTS.map((p) => `${heading(p)}\n\n`).join(""), caret: first.length + 1 };
}

/** A line that is "?" (and anything typed after it, which filters)
 *  lists the questions; picking one makes the line its heading, with
 *  the caret on the line below. */
function promptSource(ctx: CompletionContext) {
  const match = ctx.matchBefore(/^\?[^\n]*/);
  if (!match || ctx.state.doc.lineAt(ctx.pos).from !== match.from) return null;
  return {
    from: match.from + 1,
    validFor: /^[^\n]*$/,
    options: PROMPTS.map(
      (p, i): Completion => ({
        label: p,
        // In the order they are asked, not alphabetical.
        boost: -i,
        apply: (view: EditorView, _c: Completion, from: number, to: number) => {
          const line = view.state.doc.lineAt(from);
          const insert = `${heading(p)}\n`;
          const lineFrom = from - 1;
          const end = Math.max(to, line.to);
          view.dispatch({
            changes: { from: lineFrom, to: end, insert },
            selection: { anchor: lineFrom + insert.length },
            userEvent: "input.complete",
            scrollIntoView: true,
          });
        },
      }),
    ),
  };
}

export const promptCompletion = autocompletion({
  override: [promptSource],
  icons: false,
  activateOnTyping: true,
});
