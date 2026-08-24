//! Anthropic Messages API. Structured output goes through
//! `output_config.format`; the papers a chat carries are cached with an
//! `ephemeral` breakpoint on the system prompt (5-minute TTL).

use super::{Ask, Provider, Reply, Usage};
use crate::state::AppState;
use crate::{log, Error, Result};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::AppHandle;

const MESSAGES_API: &str = "https://api.anthropic.com/v1/messages";
const COUNT_TOKENS_API: &str = "https://api.anthropic.com/v1/messages/count_tokens";
const API_VERSION: &str = "2023-06-01";

/// Long enough for a full-paper chat to think; the client's own 120s
/// default would cut those off.
const TIMEOUT: Duration = Duration::from_secs(300);

/// Build the wire body for an `Ask`. Shared with count_tokens so the
/// preview counts exactly what the real request will send.
fn body_for(provider: &Provider, ask: &Ask) -> Value {
    let mut system = json!([{ "type": "text", "text": ask.system }]);
    if ask.cache_system {
        system[0]["cache_control"] = json!({ "type": "ephemeral" });
    }

    let mut messages = Vec::with_capacity(ask.messages.len());
    for (i, turn) in ask.messages.iter().enumerate() {
        // The page image, when there is one, rides with the first user
        // message — that's the turn the prompt describes it in.
        if i == 0 && ask.image.is_some() && turn.role == "user" {
            messages.push(json!({
                "role": "user",
                "content": [
                    { "type": "image", "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": ask.image.as_deref().unwrap_or(""),
                    } },
                    { "type": "text", "text": turn.content },
                ],
            }));
        } else {
            messages.push(json!({ "role": turn.role, "content": turn.content }));
        }
    }

    let mut body = json!({
        "model": provider.model,
        "max_tokens": ask.max_tokens,
        "system": system,
        "messages": messages,
    });
    if let Some(s) = &ask.schema {
        body["output_config"] = json!({
            "format": { "type": "json_schema", "schema": s.schema },
        });
    }
    body
}

pub async fn send(
    app: &AppHandle,
    state: &AppState,
    provider: &Provider,
    ask: Ask,
) -> Result<Reply> {
    let body = body_for(provider, &ask);
    let model = provider.model.clone();
    let started = Instant::now();

    // One retry on a transport failure (a fresh connection), so a
    // dropped pool socket doesn't look like a model error.
    let mut attempt = 0;
    let resp = loop {
        attempt += 1;
        let sent = Instant::now();
        let r = state
            .http
            .post(MESSAGES_API)
            .header("x-api-key", &provider.api_key)
            .header("anthropic-version", API_VERSION)
            .header("content-type", "application/json")
            .timeout(TIMEOUT)
            .json(&body)
            .send()
            .await;
        match r {
            Ok(resp) => break resp,
            Err(e) if attempt == 1 => log(
                app,
                "warn",
                format!(
                    "Model request failed after {:.0}s ({e}) — retrying once…",
                    sent.elapsed().as_secs_f32()
                ),
            ),
            Err(e) => return Err(e.into()),
        }
    };

    let status = resp.status();
    let out: Value = resp.json().await?;
    if !status.is_success() {
        let msg = out["error"]["message"].as_str().unwrap_or("unknown error");
        return Err(Error::msg(format!(
            "Anthropic API error (HTTP {status}): {msg}"
        )));
    }
    if out["stop_reason"].as_str() == Some("refusal") {
        return Err(Error::msg("The model declined this request"));
    }

    let u = &out["usage"];
    let usage = Usage {
        input_tokens: u["input_tokens"].as_u64().unwrap_or(0),
        output_tokens: u["output_tokens"].as_u64().unwrap_or(0),
        cached_input_tokens: u["cache_read_input_tokens"].as_u64().unwrap_or(0),
        cache_write_tokens: u["cache_creation_input_tokens"].as_u64().unwrap_or(0),
    };
    log(
        app,
        "info",
        format!(
            "← {model} replied in {:.1}s ({} in, {} cached, {} out, stop: {})",
            started.elapsed().as_secs_f32(),
            usage.input_tokens,
            usage.cached_input_tokens,
            usage.output_tokens,
            out["stop_reason"].as_str().unwrap_or("?"),
        ),
    );

    let text = out["content"]
        .as_array()
        .and_then(|blocks| {
            blocks
                .iter()
                .find(|b| b["type"].as_str() == Some("text"))
                .and_then(|b| b["text"].as_str())
        })
        .map(String::from)
        .ok_or_else(|| Error::msg("Empty response from the model"))?;
    Ok(Reply { text, usage })
}

/// Exact input-token count for a request that hasn't been sent yet —
/// what the cost preview quotes. Free, and it counts the same body the
/// real call will use.
pub async fn count_tokens(state: &AppState, provider: &Provider, ask: &Ask) -> Result<u64> {
    let mut body = body_for(provider, ask);
    // Not a generation request: these fields are rejected here.
    if let Some(obj) = body.as_object_mut() {
        obj.remove("max_tokens");
        obj.remove("output_config");
    }
    let resp = state
        .http
        .post(COUNT_TOKENS_API)
        .header("x-api-key", &provider.api_key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json")
        .timeout(Duration::from_secs(60))
        .json(&body)
        .send()
        .await?;
    let status = resp.status();
    let out: Value = resp.json().await?;
    if !status.is_success() {
        let msg = out["error"]["message"].as_str().unwrap_or("unknown error");
        return Err(Error::msg(format!(
            "Anthropic API error (HTTP {status}): {msg}"
        )));
    }
    out["input_tokens"]
        .as_u64()
        .ok_or_else(|| Error::msg("No token count in the response"))
}
