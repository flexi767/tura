import type { Message, Session } from "@tura/gateway-sdk";
import Activity from "lucide-solid/icons/activity";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { formatDuration } from "./message-tools";
import {
  contextUsageDiagnostics,
  providerQuotaDiagnostics,
  turnLatencyDiagnostics,
} from "./latency-diagnostics";

const tokenCount = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function LatencyDiagnosticsPanel(props: { messages: Message[]; session?: Session }) {
  const [open, setOpen] = createSignal(false);
  const [uiRenderMs, setUiRenderMs] = createSignal<number>();
  let frame: number | undefined;
  createEffect(() => {
    const signature = props.messages
      .slice(-2)
      .map(
        (message) =>
          `${message.id}:${message.updated_at ?? message.time?.updated ?? 0}:${message.parts.length}`,
      )
      .join("|");
    if (!signature || typeof requestAnimationFrame === "undefined") return;
    const started = performance.now();
    frame = requestAnimationFrame(() => setUiRenderMs(Math.max(0, performance.now() - started)));
  });
  onCleanup(() => frame !== undefined && cancelAnimationFrame(frame));
  const diagnostics = createMemo(() =>
    turnLatencyDiagnostics(props.messages, props.session, uiRenderMs()),
  );
  const context = createMemo(() => contextUsageDiagnostics(props.session));
  const quota = createMemo(() => providerQuotaDiagnostics(props.session));
  const rows = createMemo(
    () =>
      [
        ["Routing", diagnostics().routingMs, "Before the provider request"],
        ["Provider queue", diagnostics().providerQueueMs, "Reported provider queue time"],
        ["First token", diagnostics().firstTokenMs, "Provider request to first output"],
        ["Provider", diagnostics().providerMs, "Complete provider call"],
        ["Tools", diagnostics().toolExecutionMs, "Combined tool execution"],
        ["Persistence", diagnostics().persistenceMs, "Final message to idle session state"],
        ["UI render", diagnostics().uiRenderMs, "Latest reactive update to browser paint"],
      ] as const,
  );
  return (
    <div class="latency-diagnostics">
      <button
        type="button"
        class="latency-trigger"
        onClick={() => setOpen(!open())}
        aria-expanded={open()}
      >
        <Activity size={15} />
        <span>Timing</span>
        <Show when={diagnostics().totalMs !== undefined}>
          <strong>{formatDuration(diagnostics().totalMs!)}</strong>
        </Show>
        <Show when={context()}>
          {(usage) => <span class="latency-context-percent">{usage().percent.toFixed(0)}%</span>}
        </Show>
      </button>
      <Show when={open()}>
        <div class="latency-popover" role="status">
          <div class="latency-title">Latest response</div>
          <For each={rows()}>
            {([label, value, detail]) => (
              <div class="latency-row" title={detail}>
                <span>{label}</span>
                <strong>{value === undefined ? "—" : formatDuration(value)}</strong>
              </div>
            )}
          </For>
          <p>Unavailable stages stay blank instead of being estimated.</p>
          <Show when={context()}>
            {(usage) => (
              <section class="context-usage" aria-label="Context usage">
                <div class="latency-title">Current context</div>
                <div class="context-meter" aria-hidden="true">
                  <span style={{ width: `${usage().percent}%` }} />
                </div>
                <div class="latency-row">
                  <span>Used</span>
                  <strong>
                    {tokenCount.format(usage().used)} / {tokenCount.format(usage().limit)} tokens
                  </strong>
                </div>
                <div class="latency-row">
                  <span>Context used</span>
                  <strong>{usage().percent.toFixed(1)}%</strong>
                </div>
                <div class="latency-row">
                  <span>Compaction</span>
                  <strong>in {tokenCount.format(usage().remaining)} tokens</strong>
                </div>
                <Show when={usage().latestTurnTokens !== undefined}>
                  <div class="latency-row">
                    <span>Latest turn</span>
                    <strong>{tokenCount.format(usage().latestTurnTokens!)} tokens</strong>
                  </div>
                </Show>
              </section>
            )}
          </Show>
          <Show when={quota()}>
            {(usage) => (
              <section class="provider-quota" aria-label="Provider usage limits">
                <div class="latency-title">
                  Account usage
                  <Show when={usage().plan}>
                    {" "}
                    <span>{usage().plan}</span>
                  </Show>
                </div>
                <For each={usage().windows}>
                  {(window) => (
                    <div class="quota-window">
                      <div class="quota-heading">
                        <strong>{window.label}</strong>
                        <span>{window.usedPercent.toFixed(0)}% used</span>
                      </div>
                      <div class="context-meter quota-meter" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, window.usedPercent)}%` }} />
                      </div>
                      <div class="quota-reset">
                        <strong>{window.leftPercent.toFixed(0)}% left</strong>
                        <Show when={window.resetsAt}>
                          {(reset) => (
                            <span>
                              resets {formatResetDistance(reset())} · {formatResetTime(reset())}
                            </span>
                          )}
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </section>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}

function formatResetDistance(resetsAt: number) {
  let minutes = Math.max(0, Math.ceil((resetsAt - Date.now()) / 60_000));
  const days = Math.floor(minutes / 1_440);
  minutes -= days * 1_440;
  const hours = Math.floor(minutes / 60);
  minutes -= hours * 60;
  if (days) return `in ${days}d ${hours}h`;
  if (hours) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
}

function formatResetTime(resetsAt: number) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(resetsAt));
}
