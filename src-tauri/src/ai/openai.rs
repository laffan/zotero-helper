//! OpenAI Chat Completions. The GPT-5.6 models cache prompt prefixes
//! automatically (90% off reads, ~30-minute reuse window), so nothing
//! has to be asked for — keeping the papers at the head of the request
//! and never rewriting them is the whole technique.

use super::{Ask, Provider, Reply, Usage};
use crate::state::AppState;
use crate::{log, Error, Result};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::AppHandle;

const CHAT_API: &str = "https://api.openai.com/v1/chat/completions";
const TIMEOUT: Duration = Duration::from_secs(300);

fn body_for(provider: &Provider, ask: &Ask) -> Value {
    let mut messages = vec![json!({ "role": "system", "content": ask.system })];
    for (i, turn) in ask.messages.iter().enumerate() {
        if i == 0 && ask.image.is_some() && turn.role == "user" {
            messages.push(json!({
                "role": "user",
                "content": [
                    { "type": "image_url", "image_url": {
                        "url": format!(
                            "data:image/jpeg;base64,{}",
                            ask.image.as_deref().unwrap_or(""),
                        ),
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
        // Reasoning models take max_completion_tokens, not max_tokens,
        // and the budget has to cover the reasoning they do first.
        "max_completion_tokens": ask.max_tokens,
        "messages": messages,
    });
    if let Some(s) = &ask.schema {
        body["response_format"] = json!({
            "type": "json_schema",
            "json_schema": {
                "name": s.name,
                "strict": s.strict,
                "schema": s.schema,
            },
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

    let mut attempt = 0;
    let resp = loop {
        attempt += 1;
        let sent = Instant::now();
        let r = state
            .http
            .post(CHAT_API)
            .header("authorization", format!("Bearer {}", provider.api_key))
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
        return Err(Error::msg(format!("OpenAI API error (HTTP {status}): {msg}")));
    }

    let choice = &out["choices"][0];
    let finish = choice["finish_reason"].as_str().unwrap_or("?");
    if finish == "content_filter" {
        return Err(Error::msg("The model declined this request"));
    }

    let u = &out["usage"];
    let cached = u["prompt_tokens_details"]["cached_tokens"]
        .as_u64()
        .unwrap_or(0);
    let usage = Usage {
        // prompt_tokens counts the cached prefix too; the frontend
        // prices the two at different rates, so split them here.
        input_tokens: u["prompt_tokens"].as_u64().unwrap_or(0).saturating_sub(cached),
        output_tokens: u["completion_tokens"].as_u64().unwrap_or(0),
        cached_input_tokens: cached,
        // OpenAI does not bill a separate cache write.
        cache_write_tokens: 0,
    };
    log(
        app,
        "info",
        format!(
            "← {model} replied in {:.1}s ({} in, {} cached, {} out, finish: {finish})",
            started.elapsed().as_secs_f32(),
            usage.input_tokens,
            usage.cached_input_tokens,
            usage.output_tokens,
        ),
    );

    let text = choice["message"]["content"]
        .as_str()
        .map(str::to_string)
        .filter(|t| !t.trim().is_empty())
        .ok_or_else(|| Error::msg("Empty response from the model"))?;
    Ok(Reply { text, usage })
}
