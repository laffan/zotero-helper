//! Everything that talks to a language model. One request shape (`Ask`)
//! and one reply shape (`Reply`) sit in front of two providers, so the
//! features above — AI Tidy, Get Abstract, and the abstract/full-paper
//! chats — never branch on which service the user configured.
//!
//!   mod       — provider resolution + dispatch (this file)
//!   anthropic — Anthropic Messages API
//!   openai    — OpenAI Chat Completions
//!   tidy      — AI Tidy Metadata / Get Abstract
//!   chat      — the Questions conversations
mod anthropic;
mod chat;
mod openai;
mod tidy;

pub use chat::{chat, count_tokens, title, ChatReply, TokenCount};
pub use tidy::{get_abstract, tidy_item};

use crate::state::AppState;
use crate::{Error, Result};
use serde_json::Value;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Service {
    Anthropic,
    OpenAi,
}

impl Service {
    fn parse(s: &str) -> Service {
        match s.trim().to_ascii_lowercase().as_str() {
            "openai" => Service::OpenAi,
            _ => Service::Anthropic,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Service::Anthropic => "Anthropic",
            Service::OpenAi => "OpenAI",
        }
    }
}

/// The configured service, its key, and the model to call — resolved
/// once per request so a mid-request settings change can't split a call
/// across two providers.
pub struct Provider {
    pub service: Service,
    pub api_key: String,
    pub model: String,
}

impl Provider {
    /// Read the active provider out of settings. Errors with the message
    /// the UI shows when no key has been entered yet.
    pub async fn resolve(state: &AppState) -> Result<Provider> {
        let s = state.settings.read().await;
        let service = Service::parse(&s.ai_service);
        let (api_key, model) = match service {
            Service::Anthropic => (
                s.anthropic_api_key.trim().to_string(),
                s.anthropic_model.trim().to_string(),
            ),
            Service::OpenAi => (
                s.openai_api_key.trim().to_string(),
                s.openai_model.trim().to_string(),
            ),
        };
        if api_key.is_empty() {
            return Err(Error::msg(format!(
                "No {} API key configured — add one in Settings first",
                service.label()
            )));
        }
        if model.is_empty() {
            return Err(Error::msg(format!(
                "No {} model chosen — pick one in Settings first",
                service.label()
            )));
        }
        Ok(Provider {
            service,
            api_key,
            model,
        })
    }
}

/// One turn of a conversation. Only "user" and "assistant" ever reach a
/// provider — the system prompt travels separately on `Ask`.
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
pub struct Turn {
    pub role: String,
    pub content: String,
}

/// A single request, in provider-neutral terms.
pub struct Ask {
    pub system: String,
    /// Mark the system prompt cacheable. Worth it for the papers a chat
    /// carries (they repeat on every turn); pointless for a one-shot.
    pub cache_system: bool,
    pub messages: Vec<Turn>,
    pub max_tokens: u32,
    /// The JSON shape the reply must satisfy, when the caller wants
    /// JSON back rather than prose.
    pub schema: Option<AskSchema>,
    /// Base64 JPEG shown alongside the first user message.
    pub image: Option<String>,
}

impl Ask {
    pub fn new(system: impl Into<String>, messages: Vec<Turn>) -> Ask {
        Ask {
            system: system.into(),
            cache_system: false,
            messages,
            max_tokens: 4096,
            schema: None,
            image: None,
        }
    }

    /// One user message — the shape every non-chat feature uses.
    pub fn single(system: impl Into<String>, prompt: impl Into<String>) -> Ask {
        Ask::new(
            system,
            vec![Turn {
                role: "user".into(),
                content: prompt.into(),
            }],
        )
    }
}

/// A JSON schema for the reply. `strict` asks the provider to *enforce*
/// it rather than merely aim at it — only possible for closed objects
/// that require every property, which rules out the tidy schema (its
/// whole point is that the model omits the fields it isn't changing).
pub struct AskSchema {
    pub name: &'static str,
    pub schema: Value,
    pub strict: bool,
}

/// What a request cost, in the provider's own accounting. Cached reads
/// and cache writes are billed at different rates, so they're kept
/// apart and priced in the frontend's model catalog.
#[derive(Clone, Copy, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cached_input_tokens: u64,
    pub cache_write_tokens: u64,
}

pub struct Reply {
    pub text: String,
    pub usage: Usage,
}

/// Send `ask` to whichever provider `provider` names.
pub async fn send(
    app: &tauri::AppHandle,
    state: &AppState,
    provider: &Provider,
    ask: Ask,
) -> Result<Reply> {
    match provider.service {
        Service::Anthropic => anthropic::send(app, state, provider, ask).await,
        Service::OpenAi => openai::send(app, state, provider, ask).await,
    }
}

/// Parse a reply that was requested under a JSON schema.
pub fn parse_json(text: &str) -> Result<Value> {
    serde_json::from_str(text.trim())
        .map_err(|e| Error::msg(format!("Model returned invalid JSON: {e}")))
}

/// Rough token count for text, used where the provider offers no
/// counting endpoint. Four characters per token is the usual English
/// prose approximation and is close enough for a cost preview.
pub fn estimate_tokens(text: &str) -> u64 {
    (text.chars().count() as u64).div_ceil(4)
}
