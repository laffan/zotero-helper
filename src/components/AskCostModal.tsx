// The confirmation between reading the works and spending money on
// them. Full papers can be hundreds of thousands of tokens, and the
// difference between a cent and five dollars should be visible before
// the first question, not after it.
//
// It also gives the gaps somewhere to be fixed. A folder where half the
// entries have no abstract makes for a poor conversation, and the app
// already knows how to go and get them — so it offers, and re-prices
// once it has, since retrieval changes the token count.
import { confirmAsk, refillAsk } from "../lib/ai/chat";
import {
  cachedFollowUpCost,
  estimateCost,
  findModel,
  formatTokens,
  formatUsd,
  modelLabel,
  TYPICAL_REPLY_TOKENS,
} from "../lib/ai/models";
import { useStore } from "../lib/store";
import type { PendingAsk } from "../lib/types";
import { Spinner } from "./Icons";
import { Modal } from "./Modal";

/** The "N works are missing X — shall I fetch them?" block. */
function Gaps({ ask, busy }: { ask: PendingAsk; busy: boolean }) {
  if (ask.gaps.length === 0) return null;
  const full = ask.source.depth === "full";
  const fixable = ask.gaps.filter((g) => g.fixable);
  const stuck = ask.gaps.length - fixable.length;
  const what = full ? "PDF" : "abstract";
  const plural = ask.gaps.length === 1 ? "" : "s";

  return (
    <div className="ask-gaps">
      <p className="ask-cost-warn">
        {ask.gaps.length} work{plural} ha{ask.gaps.length === 1 ? "s" : "ve"} no{" "}
        {what}: {ask.gaps.slice(0, 3).map((g) => g.title).join("; ")}
        {ask.gaps.length > 3 ? `; +${ask.gaps.length - 3} more` : ""}
      </p>
      {stuck > 0 && !full && (
        <p className="hint">
          {stuck} of {ask.gaps.length === 1 ? "them" : "those"} ha
          {stuck === 1 ? "s" : "ve"} no PDF to read an abstract out of —
          fetch their PDFs first, then come back.
        </p>
      )}
      {fixable.length > 0 && (
        <button className="tool-btn" onClick={() => void refillAsk(ask)} disabled={busy}>
          {busy ? <Spinner size={13} /> : null}
          {busy
            ? full
              ? "Fetching PDFs…"
              : "Reading abstracts…"
            : full
              ? `Fetch the ${fixable.length} missing PDF${fixable.length === 1 ? "" : "s"}`
              : `Get the ${fixable.length} missing abstract${fixable.length === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}

export function AskCostModal({ onClose }: { onClose: () => void }) {
  const ask = useStore((s) => s.pendingAsk);
  const busy = useStore((s) => s.askPreparing);
  if (!ask) return null;

  const model = findModel(ask.model);
  const first = estimateCost(ask.model, ask.tokens, TYPICAL_REPLY_TOKENS);
  const later = cachedFollowUpCost(
    ask.model,
    ask.tokens,
    TYPICAL_REPLY_TOKENS,
  );
  const overflows = model ? ask.tokens > model.contextTokens : false;
  const about = ask.exact ? "" : "about ";

  return (
    <Modal title="Send these works to the model?" onClose={onClose}>
      <div className="ask-cost">
        <div className="ask-cost-headline">
          <strong>{formatTokens(ask.tokens)} tokens</strong>
          <span>
            {ask.source.itemKeys.length} work
            {ask.source.itemKeys.length === 1 ? "" : "s"} ·{" "}
            {ask.source.depth === "full" ? "full text" : "abstracts"} ·{" "}
            {modelLabel(ask.model)}
          </span>
        </div>

        <table className="ask-cost-table">
          <tbody>
            <tr>
              <th>First question</th>
              <td>
                {about}
                {formatUsd(first)}
              </td>
            </tr>
            <tr>
              <th>Each one after</th>
              <td>
                {about}
                {formatUsd(later)}
                <span className="ask-cost-note">
                  while the works are still cached
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        <p className="hint">
          {ask.exact
            ? "Counted by the provider; the reply's length is assumed, so the totals are estimates."
            : "Token count is an approximation — this provider offers no counting endpoint."}
        </p>

        <Gaps ask={ask} busy={busy} />

        {overflows && model && (
          <p className="ask-cost-warn">
            This is more than {modelLabel(ask.model)} can hold (
            {formatTokens(model.contextTokens)}). Pick a larger model in
            Settings, or ask about fewer works.
          </p>
        )}

        <div className="ask-cost-actions">
          <button className="tool-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="tool-btn accent"
            onClick={() => confirmAsk(ask)}
            disabled={overflows || busy}
          >
            Start the conversation
          </button>
        </div>
      </div>
    </Modal>
  );
}
