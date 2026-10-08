# BUILD.md — 2026-10-08 AgentTrace

Idea source: `ideas/2026-10-08.md` #1 (RECOMMENDED). Type `dashboard`, tier `upwork`.

## Verification run at build time

| Check | Command | Result |
|---|---|---|
| Production build | `npm run build` | **exit 0** |
| Lint | `npx eslint src --max-warnings=0` | **exit 0**, 0 warnings |
| Tests | `npm test` | **31/31 pass**, exit 0 |
| Serves and renders | `next start -p 3148` + `curl /` | **HTTP 200**, 52,316 bytes |
| Output is real, not placeholder | grep SSR HTML | Contains `Retry loop: web_search`, `Langkah berulang: fetch_page ×3`, `Langkah termahal: chat claude-sonnet-4-5`, `4.82 s`, `$0.0299` — computed by the analyzer during SSR, not hardcoded strings |
| Disclosure labels present in HTML | grep SSR HTML | fixture-is-handwritten label ✓, price as-of date ✓, `gen-ai-dev/1.42.0-dev` dev-stability ✓ |

Zero runtime dependencies beyond `next` / `react` / `react-dom`. No env vars, no network calls at
runtime. Vercel-deployable as-is.

## Spec verification — I downloaded it, as instructed

Scout said to trust the files over the summary. I did, and **scout's claims check out**, with one
correction to *how* they are expressed in the YAML:

```
model/manifest.yaml        → HTTP 200   schema_url .../gen-ai-dev/1.42.0-dev, stability: development
model/gen-ai/spans.yaml    → HTTP 200   45,638 bytes
model/gen-ai/registry.yaml → HTTP 200   46,869 bytes
```

Confirmed present:

- `gen_ai.operation.name` members include `chat`, `retrieval`, `invoke_agent`, `execute_tool`, `plan`.
- Span definitions include `gen_ai.invoke_agent.client`, **`gen_ai.invoke_agent.internal`**,
  **`gen_ai.execute_tool.internal`**, `gen_ai.invoke_workflow.internal`, `gen_ai.plan.internal`,
  `gen_ai.embeddings.client`, `gen_ai.retrieval.client`, `gen_ai.create_agent.client`,
  `gen_ai.memory.client`, `gen_ai.client.inference`.
- Span naming conventions `invoke_agent {gen_ai.agent.name}` and `execute_tool {gen_ai.tool.name}`.
- Token attributes `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, plus the
  `cache_read` / `cache_write` / `text.*` / `image.*` / `audio.*` breakdown.

**Correction to scout's note (minor, no impact on the build):** scout listed span names as `id:`
entries. In `spans.yaml` the attribute *groups* use `id:` while the span definitions use **`type:`**
(e.g. `- type: gen_ai.execute_tool.internal`). My first grep for `id: gen_ai.*` found only three
entries and looked like scout was wrong; grepping `type:` showed all 11 span definitions. Scout's
substance was correct.

**Two findings scout did not mention, both of which changed the code:**

1. `gen_ai.execute_tool.internal` is spelled exactly that in `spans.yaml` — but there are also
   *refinements* (`gen_ai.execute_tool.load_skill.internal`, `.read_skill_resource.internal`,
   `.command.internal`). The detectors therefore key on the **`gen_ai.operation.name` attribute**,
   not on the span type string, so refinements are handled without enumerating them.
2. `registry.yaml` states that `cache_read.input_tokens` and `cache_write.input_tokens`
   **"SHOULD be included in `gen_ai.usage.input_tokens`"**. Naively adding cache tokens to input
   tokens for costing double-charges them. `pricing.ts` subtracts cached reads from input before
   applying the full rate. There is a test asserting the discounted figure is lower than the naive
   one.

## Done

- **Parser** (`src/lib/parse.ts`) — accepts a bare span array and OTLP `{resourceSpans:[...]}`
  (plus legacy `instrumentationLibrarySpans`). Stops at those two shapes, per scope. Unwraps every
  OTLP `AnyValue` variant (`stringValue`/`intValue`/`doubleValue`/`boolValue`/`arrayValue`) and
  also accepts plain `{key: value}` attributes. **uint64 ns timestamps parsed via `BigInt`** →
  microseconds.
- **Tree builder** (`analyze.ts`) — nests by `parentSpanId`, sorts children by start time, assigns
  depth, emits depth-first row order. Orphans promoted to roots with a warning; parent cycles
  detected and broken with a warning; every span still appears exactly once.
- **Waterfall timeline** (`Waterfall.tsx`) — absolute-positioned divs, offset/width as percentages
  of the trace window, indentation from depth, per-operation colour, red bar + `ERR` badge on error
  status, inline duration/tokens/cost. **No chart library.** Zero-duration spans keep a 2px
  hairline so they remain visible and clickable.
- **Token + cost rollup** — totals, per-operation table sorted by cost, cache-aware pricing from a
  hand-entered table labelled in the UI with its as-of date (`2026-10-08`) and "acuan manual".
  Unknown models report *tidak diketahui*, never a guess.
- **Three detectors** — retry loop, repeated step (threshold 3), most expensive step (USD, with
  token fallback when nothing is priced). Clicking a finding highlights its spans in the waterfall.
- **Span detail panel** — raw sorted attributes, status, cache breakdown with the "already included
  in input_tokens" note.
- **Two example traces + the same problem trace as a flat array**, all hand-written, labelled in
  the UI as hand-written demo data in an amber callout.
- **31 tests** (`src/lib/analyze.test.ts`), `node:test`, no framework.

## Bug found and fixed by the tests

`detectRetryLoops` listed a span twice when a failed call was itself a retry of an earlier failure
(the span appeared in both the `failed` and `retries` arrays), inflating the "N span" count on the
finding. Caught by the assertion on `spanIds.length`; fixed by de-duplicating through a `Set`.
Two other initial test failures were **wrong expectations in the test file**, not product bugs — I
had written 14 spans / 9 untokened for a 13-span fixture; corrected to match the fixture.

## Stubbed / deliberately out of scope

- **No OTLP ingestion.** Paste only — no collector, no gRPC, no HTTP receiver, no backend
  connection. Explicitly excluded by the scope note.
- **No zoom, scrub, or pan** on the timeline. Scope guard against the waterfall blowing up, which
  the idea file flagged as the main risk.
- **Only two input shapes.** A third (e.g. Langfuse or LangSmith native JSON) is not accepted.
- **Price table is static.** Thirteen models hand-entered. `ponytail:` ceiling — a JSON price file
  or a build-time fetch is the upgrade path; not worth it until someone asks, and a runtime pricing
  fetch would break the zero-network property that makes the demo deployable with no secrets.
- **No multi-trace aggregation**, no persistence, no export, no comparison between two runs.
- Cost totals ignore `cache_write` pricing (vendors charge a write premium). Cache writes are
  *displayed* per span but costed at the plain input rate. Noted here rather than faked.

## Next steps, in the order I'd do them

1. **Deploy to Vercel** and put the URL in README (`[Live demo link placeholder]`) — it is the only
   thing standing between this and meeting the Upwork-tier live-demo requirement.
2. Add a **latency-outlier detector** (span far slower than siblings of the same operation) — the
   most obviously missing fourth finding.
3. Accept a **third input shape** so people can paste from a hosted tracer without converting.
4. Move the price table to a dated JSON file with a visible "prices from" banner.
5. Cost the `cache_write` premium properly once a vendor rate is confirmed.

## Factory rules

Staging only. `projects/` untouched, nothing pushed, nothing listed. No fabricated screenshots, no
invented metrics, no Upwork job numbers anywhere in the README — scout had none to give and I did
not substitute any.
