//! The Questions conversations: a fixed set of papers in the system
//! prompt, then an ordinary back-and-forth on top of it.
//!
//! The papers never change once a chat is created, which is the whole
//! design: they sit at the head of every request as a cacheable prefix,
//! so the second and later turns re-read them at the cached rate rather
//! than paying full price for the same 200 pages.
//!
//! An explainer (the reader's selection bar: "explain this passage") is
//! the same conversation with another system prompt — short answers
//! about a passage on its own terms, with no material at all; and a
//! look-up ("define"), one question and one answer of at most 50 words,
//! never kept as a conversation.

use super::{estimate_tokens, send, Ask, AskSchema, Provider, Service, Turn, Usage};
use super::anthropic;
use crate::state::AppState;
use crate::{log, Result};
use serde_json::json;
use tauri::AppHandle;

const CHAT_SYSTEM: &str = "You are a research assistant helping a scholar think about a set of \
works from their own Zotero library. The works are given below — depending on what they asked \
for, either the abstracts and metadata, or text extracted from the PDFs themselves. Ground every \
claim in the provided material and say plainly when something is not in it rather than filling \
the gap from general knowledge; if you do bring in outside context, mark it as such. Cite works \
by their titles (short forms are fine once established), and where a specific passage matters, \
quote it. Extracted PDF text can carry artifacts — running heads, footnotes and column breaks \
interleaved with the body — so read around them. Be concise and concrete: this is a working \
conversation, not a report. Your reply is rendered as Markdown, so use headings, lists, tables \
and emphasis where they genuinely help — a comparison across works belongs in a table.\n\n\
PAGE CITATIONS. Full-text material is broken up by page markers written as [[page 7]], meaning \
everything after that marker comes from page 7 of that work's PDF. When a claim rests on a \
specific passage, cite it in exactly this form:\n\n    [[cite:W:P]]\n\nwhere W is the work's \
number in the list below (the number in its \"## 3. Title\" heading) and P is the page number \
from the nearest preceding [[page N]] marker. For a passage spanning pages, write [[cite:W:P-Q]]. \
Put the citation immediately after the sentence it supports, in the running text — the reader's \
app turns it into a button that opens that page.\n\n\
Where a specific passage is what you are pointing at, add it after the page: \
[[cite:W:P:the exact words from the page]]. Copy them character for character from the material \
— the app searches the page for them and highlights what it finds, so an approximation simply \
fails to highlight. One sentence or clause is ideal; keep it under about forty words. If you are pointing at a page as a whole rather than a passage, \
leave the quotation off.\n\n\
Rules: use the numbers you actually read, never a guess, and never a printed folio or a citation \
from the work's own bibliography; if the material carries no [[page N]] markers (an \
abstracts-only conversation), do not cite pages at all; and never invent the [[page N]] markers \
yourself.";

const EXPLAIN_SYSTEM: &str = "You explain a concept, term or passage a scholar came across while \
reading. Explain it on its own terms, as a short encyclopedia entry would: what it is or means, \
where it comes from and why it matters. Don't guess at the work it came from, its author's aims or \
what the passage is doing there, unless asked. Keep every answer short: under 100 words, plain \
prose, no headings — follow-up questions included. Your reply is rendered as Markdown.";

const DEFINE_SYSTEM: &str = "You define words and phrases, as a dictionary does: what it \
means, in at most 50 words, with the sense most likely in scholarly writing first. Give the \
definition alone — no preamble, no restating the question, no examples unless one is needed to \
make the meaning clear. Plain text.";

const TITLE_SYSTEM: &str = "You name conversations. Given the first question and answer of a \
chat about a set of scholarly works, return JSON {\"title\": \"...\"} with a title of at most six \
words naming what the conversation is about. No quotation marks, no trailing punctuation, no \
prefix like \"Discussion of\" — just the subject itself, in title case.";

/// What the frontend gets back: the reply plus everything it needs to
/// price the call against its model catalog.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatReply {
    pub text: String,
    pub usage: Usage,
    pub model: String,
    pub service: String,
}

/// Size of a request before it's sent — what the cost popup quotes.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenCount {
    pub tokens: u64,
    /// False when this is a four-chars-per-token approximation rather
    /// than a real count from the provider.
    pub exact: bool,
    pub model: String,
    pub service: String,
}

fn service_id(service: Service) -> String {
    match service {
        Service::Anthropic => "anthropic".into(),
        Service::OpenAi => "openai".into(),
    }
}

/// Build the request for a chat turn. `context` is the papers; it is
/// byte-identical on every turn of a chat, which is what makes the
/// prefix cache hit. `mode` is the frontend's kind of conversation:
/// none for Questions, "explain" for an explainer, "define" for a
/// look-up — whose answers their prompts keep short (the token cap
/// only stops a runaway one).
fn chat_ask(context: &str, messages: Vec<Turn>, mode: Option<&str>) -> Ask {
    let (system, max_tokens) = match mode {
        Some("explain") => (EXPLAIN_SYSTEM, 1024),
        Some("define") => (DEFINE_SYSTEM, 400),
        _ => (CHAT_SYSTEM, 8192),
    };
    let system = if context.is_empty() {
        system.to_string()
    } else {
        format!("{system}\n\n{context}")
    };
    let mut ask = Ask::new(system, messages);
    ask.cache_system = true;
    ask.max_tokens = max_tokens;
    ask
}

pub async fn chat(
    app: &AppHandle,
    state: &AppState,
    context: String,
    messages: Vec<Turn>,
    mode: Option<String>,
) -> Result<ChatReply> {
    let provider = Provider::resolve(state).await?;
    let ask = chat_ask(&context, messages, mode.as_deref());
    log(
        app,
        "info",
        format!(
            "→ {}: chat turn over {} chars of source material…",
            provider.model,
            context.len()
        ),
    );
    let reply = send(app, state, &provider, ask).await?;
    Ok(ChatReply {
        text: reply.text,
        usage: reply.usage,
        model: provider.model,
        service: service_id(provider.service),
    })
}

/// Name a conversation from its opening exchange. Deliberately does not
/// include the papers — a title costs a few hundred tokens, not the
/// whole corpus again.
pub async fn title(
    app: &AppHandle,
    state: &AppState,
    question: String,
    answer: String,
) -> Result<ChatReply> {
    let provider = Provider::resolve(state).await?;
    let answer: String = answer.chars().take(2000).collect();
    let mut ask = Ask::single(
        TITLE_SYSTEM,
        format!("Question:\n{question}\n\nAnswer:\n{answer}"),
    );
    ask.max_tokens = 256;
    ask.schema = Some(AskSchema {
        name: "chat_title",
        strict: true,
        schema: json!({
            "type": "object",
            "additionalProperties": false,
            "properties": { "title": { "type": "string" } },
            "required": ["title"],
        }),
    });
    let reply = send(app, state, &provider, ask).await?;
    Ok(ChatReply {
        text: reply.text,
        usage: reply.usage,
        model: provider.model,
        service: service_id(provider.service),
    })
}

/// Count what a chat turn would send. Anthropic counts it exactly and
/// for free; OpenAI has no such endpoint, so that path approximates and
/// says so.
pub async fn count_tokens(
    state: &AppState,
    context: String,
    messages: Vec<Turn>,
) -> Result<TokenCount> {
    let provider = Provider::resolve(state).await?;
    let ask = chat_ask(&context, messages, None);
    let rough = || {
        estimate_tokens(&ask.system)
            + ask.messages.iter().map(|m| estimate_tokens(&m.content)).sum::<u64>()
    };
    let (tokens, exact) = match provider.service {
        // A failed count must not block the preview — fall back to the
        // approximation and let the popup say it's approximate.
        Service::Anthropic => match anthropic::count_tokens(state, &provider, &ask).await {
            Ok(n) => (n, true),
            Err(_) => (rough(), false),
        },
        Service::OpenAi => (rough(), false),
    };
    Ok(TokenCount {
        tokens,
        exact,
        model: provider.model,
        service: service_id(provider.service),
    })
}
