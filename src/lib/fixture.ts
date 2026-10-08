/**
 * HAND-WRITTEN EXAMPLE TRACES — NOT production data.
 *
 * These are authored by hand to exercise the analyzer. They are not captured
 * from any real system, not a benchmark, and not evidence of anyone's latency
 * or spend. The UI labels them as such on screen; do not re-present them as
 * real telemetry.
 *
 * Shape and attribute names follow the OpenTelemetry Semantic Conventions for
 * Generative AI (schema_url gen-ai-dev/1.42.0-dev, stability: development).
 * Timestamps are built from a fixed base instant so the output is deterministic.
 */

const BASE_MS = Date.parse("2026-10-08T02:14:30.000Z");

/** OTLP sends uint64 nanosecond timestamps as decimal strings. */
function ns(offsetMs: number): string {
  return String(BigInt(BASE_MS + offsetMs) * 1_000_000n);
}

type Attrs = Record<string, string | number>;

function attrList(attrs: Attrs) {
  return Object.entries(attrs).map(([key, value]) =>
    typeof value === "number"
      ? { key, value: { intValue: String(value) } }
      : { key, value: { stringValue: value } },
  );
}

interface SpanInput {
  id: string;
  parent?: string;
  name: string;
  from: number;
  to: number;
  error?: string;
  attrs: Attrs;
}

const TRACE_ID = "4a7cf1e2b9d84c3f8e1a6b5c2d0f9e71";

function span({ id, parent, name, from, to, error, attrs }: SpanInput) {
  return {
    traceId: TRACE_ID,
    spanId: id,
    ...(parent ? { parentSpanId: parent } : { parentSpanId: "0000000000000000" }),
    name,
    kind: 1,
    startTimeUnixNano: ns(from),
    endTimeUnixNano: ns(to),
    attributes: attrList(attrs),
    status: error ? { code: 2, message: error } : { code: 1 },
  };
}

function otlp(spans: ReturnType<typeof span>[]) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: attrList({ "service.name": "research-assistant", "service.version": "0.4.2" }),
        },
        scopeSpans: [
          {
            scope: { name: "example.handwritten.instrumentation", version: "0.0.0" },
            spans,
          },
        ],
      },
    ],
  };
}

const SONNET = "claude-sonnet-4-5";

/**
 * Example A — a multi-step research agent with three real problems:
 *  1. `web_search` returns HTTP 429 twice before succeeding  → retry loop
 *  2. `fetch_page` is called three times in a row            → repeated step
 *  3. the second `chat` span dominates spend                 → most expensive
 */
const PROBLEM_SPANS = [
  span({
    id: "a1000000000000a1",
    name: "invoke_agent research-assistant",
    from: 0,
    to: 4820,
    attrs: {
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": "research-assistant",
      "gen_ai.provider.name": "anthropic",
      "gen_ai.conversation.id": "conv_8812",
    },
  }),
  span({
    id: "b1000000000000b1",
    parent: "a1000000000000a1",
    name: `chat ${SONNET}`,
    from: 10,
    to: 980,
    attrs: {
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": "anthropic",
      "gen_ai.request.model": SONNET,
      "gen_ai.response.model": `${SONNET}-20260815`,
      "gen_ai.usage.input_tokens": 1840,
      "gen_ai.usage.output_tokens": 210,
      "gen_ai.usage.cache_read.input_tokens": 1200,
      "gen_ai.response.finish_reasons": "tool_use",
    },
  }),
  span({
    id: "c1000000000000c1",
    parent: "a1000000000000a1",
    name: "execute_tool web_search",
    from: 1000,
    to: 1180,
    error: "HTTP 429 dari penyedia pencarian: rate limit terlampaui",
    attrs: {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "web_search",
      "gen_ai.tool.type": "function",
      "error.type": "RateLimitError",
    },
  }),
  span({
    id: "c2000000000000c2",
    parent: "a1000000000000a1",
    name: "execute_tool web_search",
    from: 1200,
    to: 1395,
    error: "HTTP 429 dari penyedia pencarian: rate limit terlampaui",
    attrs: {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "web_search",
      "gen_ai.tool.type": "function",
      "error.type": "RateLimitError",
    },
  }),
  span({
    id: "c3000000000000c3",
    parent: "a1000000000000a1",
    name: "execute_tool web_search",
    from: 1450,
    to: 2010,
    attrs: {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "web_search",
      "gen_ai.tool.type": "function",
    },
  }),
  span({
    id: "b2000000000000b2",
    parent: "a1000000000000a1",
    name: `chat ${SONNET}`,
    from: 2030,
    to: 3180,
    attrs: {
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": "anthropic",
      "gen_ai.request.model": SONNET,
      "gen_ai.usage.input_tokens": 5200,
      "gen_ai.usage.output_tokens": 480,
      "gen_ai.usage.cache_read.input_tokens": 1200,
      "gen_ai.response.finish_reasons": "tool_use",
    },
  }),
  span({
    id: "d1000000000000d1",
    parent: "a1000000000000a1",
    name: "execute_tool fetch_page",
    from: 3200,
    to: 3380,
    attrs: { "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "fetch_page", "gen_ai.tool.type": "function" },
  }),
  span({
    id: "d2000000000000d2",
    parent: "a1000000000000a1",
    name: "execute_tool fetch_page",
    from: 3400,
    to: 3600,
    attrs: { "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "fetch_page", "gen_ai.tool.type": "function" },
  }),
  span({
    id: "d3000000000000d3",
    parent: "a1000000000000a1",
    name: "execute_tool fetch_page",
    from: 3620,
    to: 3810,
    attrs: { "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "fetch_page", "gen_ai.tool.type": "function" },
  }),
  span({
    id: "e1000000000000e1",
    parent: "a1000000000000a1",
    name: "invoke_agent summarizer",
    from: 3850,
    to: 4800,
    attrs: {
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": "summarizer",
      "gen_ai.agent.description": "Memadatkan halaman hasil pencarian menjadi ringkasan pendek",
    },
  }),
  span({
    id: "f1000000000000f1",
    parent: "e1000000000000e1",
    name: "chat gpt-4o-mini",
    from: 3870,
    to: 4300,
    attrs: {
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": "openai",
      "gen_ai.request.model": "gpt-4o-mini",
      "gen_ai.usage.input_tokens": 9800,
      "gen_ai.usage.output_tokens": 1200,
      "gen_ai.request.temperature": "0.2",
    },
  }),
  span({
    id: "f2000000000000f2",
    parent: "e1000000000000e1",
    name: "embeddings text-embedding-3-small",
    from: 4320,
    to: 4420,
    attrs: {
      "gen_ai.operation.name": "embeddings",
      "gen_ai.provider.name": "openai",
      "gen_ai.request.model": "text-embedding-3-small",
      "gen_ai.usage.input_tokens": 2400,
    },
  }),
  span({
    id: "f3000000000000f3",
    parent: "e1000000000000e1",
    name: "chat claude-haiku-4-5",
    from: 4450,
    to: 4780,
    attrs: {
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": "anthropic",
      "gen_ai.request.model": "claude-haiku-4-5",
      "gen_ai.usage.input_tokens": 1100,
      "gen_ai.usage.output_tokens": 320,
      "gen_ai.response.finish_reasons": "stop",
    },
  }),
];

/** Example B — a clean two-step trace. No retry, no repetition. */
const CLEAN_SPANS = [
  span({
    id: "aa00000000000aa0",
    name: "invoke_agent invoice-reader",
    from: 0,
    to: 1240,
    attrs: { "gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": "invoice-reader" },
  }),
  span({
    id: "bb00000000000bb0",
    parent: "aa00000000000aa0",
    name: "execute_tool read_pdf",
    from: 20,
    to: 260,
    attrs: { "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "read_pdf", "gen_ai.tool.type": "function" },
  }),
  span({
    id: "cc00000000000cc0",
    parent: "aa00000000000aa0",
    name: `chat ${SONNET}`,
    from: 280,
    to: 1220,
    attrs: {
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": "anthropic",
      "gen_ai.request.model": SONNET,
      "gen_ai.usage.input_tokens": 2600,
      "gen_ai.usage.output_tokens": 340,
      "gen_ai.response.finish_reasons": "stop",
    },
  }),
];

export const FIXTURE_JSON = JSON.stringify(otlp(PROBLEM_SPANS), null, 2);
export const CLEAN_JSON = JSON.stringify(otlp(CLEAN_SPANS), null, 2);

/** Same problem trace as a bare span array — exercises the second accepted input shape. */
export const FLAT_ARRAY_JSON = JSON.stringify(PROBLEM_SPANS, null, 2);
