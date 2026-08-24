// The confirmation between reading the works and spending money on
// them. Full papers can be hundreds of thousands of tokens, and the
// difference between a cent and five dollars should be visible before
// the first question, not after it.
import { confirmAsk } from "../lib/ai/chat";
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
import { Modal } from "./Modal";

export function AskCostModal({ onClose }: { onClose: () => void }) {
  const ask = useStore((s) => s.pendingAsk);
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

        {ask.source.missing.length > 0 && (
          <p className="ask-cost-warn">
            Nothing to read for {ask.source.missing.length} work
            {ask.source.missing.length === 1 ? "" : "s"}:{" "}
            {ask.source.missing.slice(0, 4).join("; ")}
            {ask.source.missing.length > 4 ? "…" : ""}
          </p>
        )}

        {overflows && model && (
          <p className="ask-cost-warn">
            This is more than {modelLabel(ask.model)} can hold (
            {formatTokens(model.contextTokens)}). Pick a larger model in
            Settings, or ask about fewer works.
          </p>
        )}

        <div className="ask-cost-actions">
          <button className="tool-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="tool-btn accent"
            onClick={() => confirmAsk(ask)}
            disabled={overflows}
          >
            Start the conversation
          </button>
        </div>
      </div>
    </Modal>
  );
}
