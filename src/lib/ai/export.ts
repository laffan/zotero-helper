// "Share Conversation" — the whole chat as one Markdown document.
//
// It carries the source material as well as the exchange, so the file
// is enough on its own to pick the conversation up somewhere else: hand
// it to a chat window elsewhere and the new model has exactly what this
// one had.
import { shareMarkdown } from "../share";
import type { Chat, ChatThread } from "../types";
import { plainCitations } from "./citations";
import { formatUsd, modelLabel } from "./models";
import { threadsIn } from "./threads";

/** The clarifications asked in `parentId`'s answers, and in theirs, in
 *  the order they were asked, each saying where it was asked. */
function clarifications(chat: Chat, parentId: string | null, depth: number, lines: string[]): void {
  for (const t of threadsIn(chat, parentId)) {
    const where = parentId === null ? `answer ${answerNumber(chat.messages, t)}` : "the clarification above";
    lines.push(`${"#".repeat(Math.min(3 + depth, 6))} Clarification of “${t.quote}”`, "", `_Asked of ${where}._`, "");
    for (const m of t.messages) {
      lines.push(`**${m.role === "user" ? "Question" : "Answer"}.** ${plainCitations(m.content).trim()}`, "");
    }
    clarifications(chat, t.id, depth + 1, lines);
  }
}

/** Which answer, counting from 1, a clarification was asked of. */
function answerNumber(messages: Chat["messages"], t: ChatThread): number {
  return messages.slice(0, t.messageIndex + 1).filter((m) => m.role === "assistant").length;
}

const DEPTH_LABEL = {
  abstracts: "abstracts",
  full: "full text",
} as const;

export function conversationMarkdown(chat: Chat): string {
  const started = new Date(chat.createdMs);
  const lines: string[] = [
    `# ${chat.title}`,
    "",
    `- Started: ${started.toLocaleString()}`,
    `- Model: ${modelLabel(chat.model)}`,
    `- Source: ${chat.source.label} — ${chat.source.itemKeys.length} work(s), ${DEPTH_LABEL[chat.source.depth]}`,
  ];
  if (chat.source.missing.length > 0) {
    lines.push(
      `- Incomplete: ${chat.source.missing.join("; ")}`,
    );
  }
  lines.push(`- Spent: ${formatUsd(chat.costUsd)}`, "");

  lines.push("## Conversation", "");
  if (chat.messages.length === 0) {
    lines.push("_No questions asked yet._", "");
  }
  for (const m of chat.messages) {
    lines.push(m.role === "user" ? "### Question" : "### Answer", "");
    // [[cite:2:7]] means nothing outside this app; write it as prose so
    // the file reads properly wherever it ends up.
    lines.push(plainCitations(m.content).trim(), "");
  }
  if (chat.threads?.length) {
    lines.push("## Clarifications", "", "_Passages of the answers above, asked about._", "");
    clarifications(chat, null, 0, lines);
  }

  // Last, because it's the bulk: a reader scrolls past the exchange to
  // reach it, and a model reads the whole file either way.
  lines.push(
    "---",
    "",
    "## Source material",
    "",
    "_Exactly what the model above was given._",
    "",
    chat.context.trim(),
    "",
  );
  return lines.join("\n");
}

function fileName(chat: Chat): string {
  const stem =
    chat.title
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "conversation";
  return `${stem}.md`;
}

export async function shareConversation(
  chat: Chat,
  anchor: { x: number; y: number },
): Promise<void> {
  await shareMarkdown(fileName(chat), conversationMarkdown(chat), anchor);
}
