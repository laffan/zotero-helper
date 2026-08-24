// "Share Conversation" — the whole chat as one Markdown document.
//
// It carries the source material as well as the exchange, so the file
// is enough on its own to pick the conversation up somewhere else: hand
// it to a chat window elsewhere and the new model has exactly what this
// one had.
import { shareMarkdown } from "../share";
import type { Chat } from "../types";
import { formatUsd, modelLabel } from "./models";

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
    lines.push(m.content.trim(), "");
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
