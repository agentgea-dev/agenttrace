# AgentTrace — Agent Execution Trace Reader (OTel GenAI)

Paste an OpenTelemetry trace from a multi-step LLM agent. Get a **waterfall timeline**, a
**token + cost rollup**, and **bad-pattern detection** — retry loops, repeated steps, and the
single most expensive step.

Built to demonstrate **LLM observability + agent cost engineering** for freelance clients.
Tech: Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS v4 · zero runtime dependencies.

**[Live demo link placeholder — deploy to Vercel]**

---

## The problem it solves

Teams ship an LLM agent, the bill climbs, and nobody can say which step caused it. Vendor
dashboards show totals per API key, not per *agent step*. AgentTrace takes the trace you already
export and answers three concrete questions:

1. **Where did the wall-clock time go?** — waterfall timeline, one row per span, nesting from
   `parentSpanId`.
2. **Where did the tokens and money go?** — per-span and per-operation rollup, cache-aware.
3. **What is structurally wrong?** — a tool that fails and gets retried, an agent looping over the
   same action, and the step that dominates spend.

## Who it's for

Teams and agencies already running LLM agents in production whose costs are rising and who cannot
attribute the increase to a step. Relevant freelance categories: AI Agent Development, LLM
Observability, AI Consulting / cost optimization.

## What makes it non-trivial

- **It reads a real published spec, not an invented schema.** Attribute names come from the
  OpenTelemetry [Semantic Conventions for Generative AI](https://github.com/open-telemetry/semantic-conventions-genai)
  (`schema_url: https://opentelemetry.io/schemas/gen-ai-dev/1.42.0-dev`). Spec files were
  downloaded and read during the build, not recalled. Fields used:
  `gen_ai.operation.name` (`chat`, `invoke_agent`, `execute_tool`, `embeddings`, `retrieval`,
  `plan`, `invoke_workflow`), `gen_ai.tool.name`, `gen_ai.agent.name`, `gen_ai.request.model`,
  `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`,
  `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_write.input_tokens`.
- **The uint64 timestamp problem is handled correctly.** OTLP sends `startTimeUnixNano` as a
  decimal *string* because nanoseconds since epoch (~1.79×10¹⁸) exceed
  `Number.MAX_SAFE_INTEGER` (~9.0×10¹⁵). Parsing with `Number()` silently loses precision.
  AgentTrace parses with `BigInt` and divides to microseconds. There is a test asserting the
  input really is beyond the safe range.
- **Cost arithmetic follows the spec, not intuition.** The spec states
  `gen_ai.usage.cache_read.input_tokens` is *included in* `input_tokens`. Charging both would
  double-bill cached reads. Cost is therefore `(input − cacheRead)` at full rate + `cacheRead` at
  the cached rate.
- **The waterfall is computed, not a chart library.** Bar offset and width are percentages derived
  from each span's start/end against the trace window; indentation comes from tree depth. No chart
  dependency, no SVG library.
- **The parser fails closed.** Broken JSON, a non-object root, a `parentSpanId` pointing at a
  missing span, a parent **cycle**, a self-parented span, duplicate span ids, a 2000-deep chain,
  missing or backwards end times, 5000+ spans, 2 MB input — each produces an error message or a
  warning, never a crash and never a silently dropped span.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build — must exit 0
npm test         # 31 assertions, node:test, no framework
```

**No environment variables. No API keys. No network requests at runtime.** Every calculation
happens in the browser; the pasted trace never leaves the tab. Deployable to Vercel as-is.

## How to use it

1. Open the page. A hand-written example trace is loaded and analysed immediately — findings are
   visible without typing anything.
2. Replace it with your own trace. Two input shapes are accepted:
   - a bare array of OTLP spans
   - an OTLP object: `{"resourceSpans":[{"scopeSpans":[{"spans":[...]}]}]}`
     (the legacy `instrumentationLibrarySpans` key is also read)
3. Read the findings, then click any waterfall row to inspect that span's raw attributes.

Limits: 5,000 spans, 2,000,000 input characters.

## The three detectors, stated precisely

| Finding | Fires when |
|---|---|
| **Retry loop** | An `execute_tool` span has status `ERROR`, and the same tool name is invoked again later in the trace. Reports failure count, retry count, and milliseconds burned in failed attempts. |
| **Repeated step** | An `invoke_agent` span has **≥3** direct children with the same identity (operation + tool/model). |
| **Most expensive step** | Ranks spans by USD; falls back to total tokens when no model matched the price table, so the finding still works for unknown models. Reports that span's share of the trace. |

## Suggested price

Not a product for sale as-is — this is a **portfolio/demo artifact** whose purpose is proving
capability. If packaged, the realistic form is a paid engagement (agent cost audit), not a
licence. Comparable rate band for AI engineers who work on observability and cost rather than
just wiring an SDK: **USD 40–120/hour**. No market research backs a specific number here, and
none is claimed.

## Honest limitations

- **Three detectors only.** No finding does not mean a healthy trace; it means these three
  patterns did not appear. There is no latency-outlier, no error-rate, and no prompt-quality
  analysis.
- **Prices are a hand-entered reference table**, labelled in the UI with its as-of date. They are
  not real-time, not a bill, and will go stale. No pricing API is called. Models absent from the
  table are reported as **unknown cost**, never estimated.
- **Tokens are read, never recomputed.** If your instrumentation omits `gen_ai.usage.*`, those
  spans show zero tokens. No tokenizer is bundled.
- **Paste-only input.** Not an OTLP collector. No gRPC, no HTTP receiver, no connection to Jaeger,
  Tempo, Langfuse, or any trace backend.
- **The spec is `stability: development`, not stable.** The GenAI semantic conventions are still
  changing; attribute names may move. This is stated on the page as well as here.
- **The bundled example traces are written by hand** to exercise each detector. They are labelled
  as such in the UI. They are not production telemetry, not measurements of any real system, and
  not a benchmark.
- Single trace at a time. No persistence, no comparison between runs, no aggregation across traces.

## Layout

```
src/
  app/            layout + page (server component shell)
  components/
    AgentTrace.tsx   stateful shell: input, stats, findings, rollup table
    Waterfall.tsx    CSS-positioned timeline rows
    SpanDetail.tsx   raw-attribute inspector
  lib/
    parse.ts         OTLP/array → FlatSpan[]; BigInt timestamps; fails closed
    analyze.ts       tree build (orphan + cycle safe), rollups, 3 detectors
    pricing.ts       manual price table + cache-aware cost arithmetic
    fixture.ts       hand-written example traces
    types.ts         shared types
    analyze.test.ts  31 assertions
```
