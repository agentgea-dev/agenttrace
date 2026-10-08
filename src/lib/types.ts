/**
 * Types for AgentTrace.
 *
 * Attribute names follow the OpenTelemetry Semantic Conventions for
 * Generative AI (`semantic-conventions-genai`), schema_url
 * `https://opentelemetry.io/schemas/gen-ai-dev/1.42.0-dev`,
 * `stability: development` (NOT stable — see README).
 */

/** Primitive values we accept out of an OTLP `AnyValue`. */
export type AttrValue = string | number | boolean;

export type AttrMap = Record<string, AttrValue>;

/** A span after normalisation, before tree-building. */
export interface FlatSpan {
  spanId: string;
  parentSpanId: string | null;
  traceId: string | null;
  name: string;
  /** Nanoseconds since epoch, as a BigInt-safe number of microseconds. */
  startUs: number;
  endUs: number;
  /** OTLP status code: 0 unset, 1 ok, 2 error. */
  statusCode: 0 | 1 | 2;
  statusMessage: string | null;
  attrs: AttrMap;
}

/** A span placed in the tree, with derived GenAI fields. */
export interface TraceSpan extends FlatSpan {
  depth: number;
  children: TraceSpan[];
  /** `gen_ai.operation.name`, e.g. `invoke_agent`, `execute_tool`, `chat`. */
  operation: string | null;
  /** `gen_ai.tool.name` when present. */
  toolName: string | null;
  /** `gen_ai.agent.name` when present. */
  agentName: string | null;
  /** `gen_ai.request.model` or `gen_ai.response.model`. */
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** USD, from the manual reference price table. 0 when the model is unknown. */
  costUsd: number;
  /** True when no price-table entry matched `model`. */
  costUnknown: boolean;
  durationUs: number;
}

export type ParseErrorCode =
  | "empty"
  | "too_large"
  | "bad_json"
  | "not_object"
  | "no_spans"
  | "too_many_spans"
  | "no_valid_spans";

export interface ParseOk {
  ok: true;
  spans: FlatSpan[];
  /** Non-fatal notes: dropped spans, repaired parents, detected cycles. */
  warnings: string[];
}

export interface ParseErr {
  ok: false;
  code: ParseErrorCode;
  message: string;
}

export type ParseResult = ParseOk | ParseErr;

export type FindingId = "retry_loop" | "repeated_step" | "most_expensive";

export type Severity = "warn" | "info";

export interface Finding {
  id: FindingId;
  severity: Severity;
  title: string;
  detail: string;
  /** Span ids this finding points at. */
  spanIds: string[];
}

export interface TokenRollup {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** Spans that reported tokens but whose model has no price entry. */
  unpricedSpans: number;
  /** Spans that reported no token attributes at all. */
  untokenedSpans: number;
}

export interface TraceReport {
  roots: TraceSpan[];
  /** Depth-first flattened order — this is the waterfall row order. */
  ordered: TraceSpan[];
  traceStartUs: number;
  traceEndUs: number;
  totalDurationUs: number;
  rollup: TokenRollup;
  /** Per-operation token+cost rollup, highest cost first. */
  byOperation: { operation: string; spans: number; inputTokens: number; outputTokens: number; costUsd: number }[];
  findings: Finding[];
  warnings: string[];
}
