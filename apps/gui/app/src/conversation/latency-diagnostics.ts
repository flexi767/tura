import type { Message, Session } from "@tura/gateway-sdk";
import { asRecord, toolDurationMs } from "./message-tools";

export type TurnLatencyDiagnostics = {
  routingMs?: number;
  providerQueueMs?: number;
  firstTokenMs?: number;
  providerMs?: number;
  toolExecutionMs?: number;
  persistenceMs?: number;
  uiRenderMs?: number;
  totalMs?: number;
};

export type ContextUsageDiagnostics = {
  used: number;
  limit: number;
  remaining: number;
  percent: number;
  latestTurnTokens?: number;
};

export type ProviderQuotaWindow = {
  label: string;
  usedPercent: number;
  leftPercent: number;
  resetsAt?: number;
};

export type ProviderQuotaDiagnostics = {
  plan?: string;
  windows: ProviderQuotaWindow[];
};

export function contextUsageDiagnostics(session?: Session): ContextUsageDiagnostics | undefined {
  const context = session?.usage?.context_tokens ?? session?.context_tokens;
  if (!context || context.limit <= 0) return undefined;
  const used = Math.max(0, context.input);
  const limit = context.limit;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    percent: Math.min(100, (used / limit) * 100),
    latestTurnTokens: findNumber([session?.usage?.tokens], new Set(["total_tokens"]), 0),
  };
}

export function providerQuotaDiagnostics(session?: Session): ProviderQuotaDiagnostics | undefined {
  const tokens = asRecord(session?.usage?.tokens);
  const limits = asRecord(tokens.rate_limits);
  const windows = [
    quotaWindow("Session", limits.primary),
    quotaWindow("Weekly", limits.secondary),
  ].filter((window): window is ProviderQuotaWindow => window !== undefined);
  if (windows.length === 0) return undefined;
  const plan = typeof limits.plan_type === "string" ? limits.plan_type : undefined;
  return { plan, windows };
}

function quotaWindow(name: string, value: unknown): ProviderQuotaWindow | undefined {
  const window = asRecord(value);
  const usedPercent = typeof window.used_percent === "number" ? window.used_percent : undefined;
  if (usedPercent === undefined || !Number.isFinite(usedPercent)) return undefined;
  const minutes = typeof window.window_minutes === "number" ? window.window_minutes : undefined;
  const resetsAt = typeof window.resets_at === "number" ? window.resets_at * 1000 : undefined;
  const label = minutes ? `${name} (${formatWindow(minutes)})` : name;
  return {
    label,
    usedPercent: Math.max(0, usedPercent),
    leftPercent: Math.max(0, 100 - usedPercent),
    resetsAt,
  };
}

function formatWindow(minutes: number) {
  if (minutes % 10_080 === 0) return `${minutes / 10_080}w`;
  if (minutes % 1_440 === 0) return `${minutes / 1_440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

export function turnLatencyDiagnostics(
  messages: Message[],
  session?: Session,
  uiRenderMs?: number,
): TurnLatencyDiagnostics {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) return { uiRenderMs };
  const user = messages[lastUserIndex];
  const assistantMessages = messages
    .slice(lastUserIndex + 1)
    .filter((message) => message.role === "assistant");
  const assistant = assistantMessages[0];
  const terminal = assistantMessages.at(-1);
  const sources = assistantMessages.flatMap((message) => [
    message.metadata,
    message.tokens,
    ...message.parts.flatMap((part) => [part.metadata, part.state]),
  ]);
  const firstTokenMs = firstNumber(sources, ["time_to_first_token_ms", "timeToFirstTokenMs"]);
  const providerMs = firstNumber(sources, [
    "latency_ms",
    "provider_latency_ms",
    "providerLatencyMs",
  ]);
  const providerQueueMs = firstNumber(sources, [
    "provider_queue_ms",
    "providerQueueMs",
    "queue_ms",
  ]);
  const explicitRoutingMs = firstNumber(sources, ["routing_ms", "routingMs"]);
  const userAt = messageTime(user, "created");
  const assistantAt = assistant ? messageTime(assistant, "created") : undefined;
  const terminalAt = terminal ? messageTime(terminal, "updated") : undefined;
  const sessionAt = normalizeEpoch(session?.updated_at);
  const observedFirstOutput = duration(userAt, assistantAt);
  const routingMs =
    explicitRoutingMs ?? subtractKnown(observedFirstOutput, firstTokenMs, providerQueueMs);
  const toolExecutionMs = sumToolDurations(assistantMessages);
  const persistenceMs = duration(terminalAt, sessionAt);
  return {
    routingMs,
    providerQueueMs,
    firstTokenMs,
    providerMs,
    toolExecutionMs: toolExecutionMs || undefined,
    persistenceMs,
    uiRenderMs,
    totalMs: duration(userAt, sessionAt ?? terminalAt),
  };
}

function sumToolDurations(messages: Message[]) {
  return messages.reduce(
    (total, message) =>
      total + message.parts.reduce((partTotal, part) => partTotal + (toolDurationMs(part) ?? 0), 0),
    0,
  );
}

function firstNumber(values: unknown[], keys: string[]): number | undefined {
  for (const value of values) {
    const found = findNumber(value, new Set(keys), 0);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findNumber(value: unknown, keys: Set<string>, depth: number): number | undefined {
  if (depth > 5 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNumber(item, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = asRecord(value);
  for (const [key, item] of Object.entries(record)) {
    if (keys.has(key) && typeof item === "number" && Number.isFinite(item) && item >= 0) {
      return item;
    }
  }
  for (const item of Object.values(record)) {
    const found = findNumber(item, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function messageTime(message: Message, kind: "created" | "updated") {
  return normalizeEpoch(message.time?.[kind] ?? message[`${kind}_at`]);
}

function normalizeEpoch(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value < 10_000_000_000 ? value * 1000 : value;
}

function duration(start?: number, end?: number) {
  if (start === undefined || end === undefined || end < start) return undefined;
  return Math.round(end - start);
}

function subtractKnown(total?: number, ...parts: Array<number | undefined>) {
  if (total === undefined || parts.every((part) => part === undefined)) return undefined;
  const known = parts.filter((part): part is number => part !== undefined);
  return Math.max(0, total - known.reduce((sum, part) => sum + part, 0));
}
