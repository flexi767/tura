import { describe, expect, test } from "bun:test";
import {
  contextUsageDiagnostics,
  providerQuotaDiagnostics,
  turnLatencyDiagnostics,
} from "../../../app/src/conversation/latency-diagnostics";

describe("turn latency diagnostics", () => {
  test("combines persisted provider, tool, and session timings", () => {
    const diagnostics = turnLatencyDiagnostics(
      [
        { id: "u", sessionID: "s", role: "user", created_at: 1_700_000_000_000, parts: [] },
        {
          id: "a",
          sessionID: "s",
          role: "assistant",
          created_at: 1_700_000_000_300,
          updated_at: 1_700_000_000_800,
          metadata: {
            usage: { latency_ms: 500, time_to_first_token_ms: 200, provider_queue_ms: 40 },
          },
          parts: [
            { id: "t", sessionID: "s", messageID: "a", type: "tool", state: { duration_ms: 75 } },
          ],
        },
      ],
      { id: "s", status: "idle", updated_at: 1_700_000_000_900 },
      12,
    );
    expect(diagnostics).toEqual({
      routingMs: 60,
      providerQueueMs: 40,
      firstTokenMs: 200,
      providerMs: 500,
      toolExecutionMs: 75,
      persistenceMs: 100,
      uiRenderMs: 12,
      totalMs: 900,
    });
  });

  test("leaves unavailable stages blank", () => {
    const diagnostics = turnLatencyDiagnostics([
      { id: "u", sessionID: "s", role: "user", parts: [] },
    ]);
    expect(diagnostics.routingMs).toBeUndefined();
    expect(diagnostics.providerQueueMs).toBeUndefined();
  });
});

describe("provider quota diagnostics", () => {
  test("reports only the Codex session window and ignores secondary usage", () => {
    expect(
      providerQuotaDiagnostics({
        id: "s",
        status: "idle",
        usage: {
          context_tokens: { input: 0, limit: 1 },
          tokens: {
            rate_limits: {
              plan_type: "pro",
              primary: {
                used_percent: 43,
                window_minutes: 300,
                resets_at: 2_000_000_000,
              },
              secondary: {
                used_percent: 22,
                window_minutes: 10_080,
                resets_at: 2_000_500_000,
              },
            },
          },
        },
      }),
    ).toEqual({
      plan: "pro",
      windows: [
        { label: "Session (5h)", usedPercent: 43, leftPercent: 57, resetsAt: 2_000_000_000_000 },
      ],
    });
  });
});

describe("context usage diagnostics", () => {
  test("reports current context, remaining capacity, percentage, and latest turn tokens", () => {
    expect(
      contextUsageDiagnostics({
        id: "s",
        status: "idle",
        context_tokens: { input: 12_345, limit: 76_800 },
        usage: {
          context_tokens: { input: 12_345, limit: 76_800 },
          tokens: { total_tokens: 1_234 },
        },
      }),
    ).toEqual({
      used: 12_345,
      limit: 76_800,
      remaining: 64_455,
      percent: (12_345 / 76_800) * 100,
      latestTurnTokens: 1_234,
    });
  });
});
