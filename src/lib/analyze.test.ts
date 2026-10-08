import assert from "node:assert/strict";
import { test } from "node:test";

import { REPEATED_CHILD_THRESHOLD, analyzeTrace, buildTree, formatDuration } from "./analyze.ts";
import { CLEAN_JSON, FIXTURE_JSON, FLAT_ARRAY_JSON } from "./fixture.ts";
import { MAX_INPUT_CHARS, MAX_SPANS, nanoToMicros, parseTrace, readAttrValue, readAttrs } from "./parse.ts";
import { PRICE_TABLE, costOf, priceFor } from "./pricing.ts";
import type { FlatSpan } from "./types.ts";

function parseOk(json: string) {
  const r = parseTrace(json);
  assert.equal(r.ok, true, `expected parse to succeed: ${r.ok ? "" : r.message}`);
  if (!r.ok) throw new Error("unreachable");
  return r;
}

function report(json: string) {
  const p = parseOk(json);
  return analyzeTrace(p.spans, p.warnings);
}

// ---------------------------------------------------------------- timestamps

test("nanoToMicros handles uint64 nanosecond strings beyond MAX_SAFE_INTEGER", () => {
  // 2026-10-08T02:14:30Z in ns is ~1.79e18 — unsafe as a JS number, must go via BigInt.
  const nsStr = "1791425670000000000";
  assert.ok(Number(nsStr) > Number.MAX_SAFE_INTEGER);
  assert.equal(nanoToMicros(nsStr), 1791425670000000);
});

test("nanoToMicros rejects junk, negatives and non-digits", () => {
  for (const bad of ["", "abc", "-5", "1.5", null, undefined, {}, [], NaN, -1, Infinity]) {
    assert.equal(nanoToMicros(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

// -------------------------------------------------------------------- attrs

test("readAttrValue unwraps every OTLP AnyValue variant", () => {
  assert.equal(readAttrValue({ stringValue: "chat" }), "chat");
  assert.equal(readAttrValue({ intValue: "1840" }), 1840);
  assert.equal(readAttrValue({ intValue: 1840 }), 1840);
  assert.equal(readAttrValue({ doubleValue: 0.2 }), 0.2);
  assert.equal(readAttrValue({ boolValue: false }), false);
  assert.equal(readAttrValue({ arrayValue: { values: [{ stringValue: "a" }, { stringValue: "b" }] } }), "a, b");
  assert.equal(readAttrValue({ unknownValue: 1 }), null);
  assert.equal(readAttrValue(undefined), null);
});

test("readAttrs accepts both the OTLP key/value list and a plain object", () => {
  const fromList = readAttrs([{ key: "gen_ai.operation.name", value: { stringValue: "chat" } }]);
  const fromObject = readAttrs({ "gen_ai.operation.name": "chat" });
  assert.deepEqual(fromList, fromObject);
  // Malformed entries are skipped, not fatal.
  assert.deepEqual(readAttrs([{ novalue: true }, "nope", null]), {});
});

// ------------------------------------------------------------ parse failures

test("parser fails closed on every malformed input instead of throwing", () => {
  const cases: [string, string][] = [
    ["", "empty"],
    ["   \n ", "empty"],
    ["{not json", "bad_json"],
    ['"a string"', "not_object"],
    ["42", "not_object"],
    ["null", "not_object"],
    ["{}", "no_spans"],
    ['{"resourceSpans":[]}', "no_valid_spans"],
    ["[]", "no_valid_spans"],
    ['[{"name":"no timestamp"}]', "no_valid_spans"],
    ['[{"spanId":"a","startTimeUnixNano":"not-a-number"}]', "no_valid_spans"],
  ];
  for (const [input, code] of cases) {
    const r = parseTrace(input);
    assert.equal(r.ok, false, `expected failure for ${JSON.stringify(input)}`);
    if (!r.ok) assert.equal(r.code, code, `wrong code for ${JSON.stringify(input)}`);
  }
});

test("parser rejects oversized input and span counts without parsing them", () => {
  const big = parseTrace("x".repeat(MAX_INPUT_CHARS + 1));
  assert.equal(big.ok, false);
  if (!big.ok) assert.equal(big.code, "too_large");

  const many = JSON.stringify(
    Array.from({ length: MAX_SPANS + 1 }, (_, i) => ({ spanId: `s${i}`, startTimeUnixNano: "1000000" })),
  );
  const r = parseTrace(many);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "too_many_spans");
});

test("end time missing or before start collapses to zero duration with a warning", () => {
  const r = parseOk(
    JSON.stringify([
      { spanId: "a", name: "no end", startTimeUnixNano: "2000000000" },
      { spanId: "b", name: "backwards", startTimeUnixNano: "2000000000", endTimeUnixNano: "1000000000" },
    ]),
  );
  assert.equal(r.spans.length, 2);
  for (const s of r.spans) assert.equal(s.endUs, s.startUs);
  assert.ok(r.warnings.some((w) => w.includes("berdurasi 0")));
});

test("duplicate and missing span ids get distinct synthetic ids so tree nodes cannot collapse", () => {
  const r = parseOk(
    JSON.stringify([
      { spanId: "dup", startTimeUnixNano: "1000000" },
      { spanId: "dup", startTimeUnixNano: "2000000" },
      { startTimeUnixNano: "3000000" },
    ]),
  );
  assert.equal(new Set(r.spans.map((s) => s.spanId)).size, 3);
});

test("an all-zero parentSpanId is read as no parent, per the OTLP wire format", () => {
  const r = parseOk(JSON.stringify([{ spanId: "a", parentSpanId: "0000000000000000", startTimeUnixNano: "1000000" }]));
  assert.equal(r.spans[0].parentSpanId, null);
});

// -------------------------------------------------------------- both shapes

test("OTLP resourceSpans and a bare span array produce identical analysis", () => {
  const fromOtlp = report(FIXTURE_JSON);
  const fromArray = report(FLAT_ARRAY_JSON);
  assert.equal(fromArray.ordered.length, fromOtlp.ordered.length);
  assert.equal(fromArray.rollup.inputTokens, fromOtlp.rollup.inputTokens);
  assert.deepEqual(
    fromArray.findings.map((f) => f.id),
    fromOtlp.findings.map((f) => f.id),
  );
});

test("legacy instrumentationLibrarySpans wrapper is still read", () => {
  const r = parseOk(
    JSON.stringify({
      resourceSpans: [{ instrumentationLibrarySpans: [{ spans: [{ spanId: "a", startTimeUnixNano: "1000000" }] }] }],
    }),
  );
  assert.equal(r.spans.length, 1);
});

// ---------------------------------------------------------------- tree build

test("tree nests by parentSpanId and depth-first order drives the waterfall", () => {
  const rep = report(FIXTURE_JSON);
  assert.equal(rep.roots.length, 1);
  assert.equal(rep.ordered.length, 13);
  assert.equal(rep.ordered[0].depth, 0);
  // Children are deeper than their parent and sorted by start time.
  for (const span of rep.ordered) {
    for (const child of span.children) {
      assert.equal(child.depth, span.depth + 1);
    }
    const starts = span.children.map((c) => c.startUs);
    assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  }
  // The nested sub-agent's children sit at depth 2.
  const nested = rep.ordered.filter((s) => s.depth === 2);
  assert.equal(nested.length, 3);
});

test("a parentSpanId pointing nowhere promotes the span to root with a warning", () => {
  const r = parseOk(
    JSON.stringify([
      { spanId: "a", startTimeUnixNano: "1000000" },
      { spanId: "b", parentSpanId: "ghost", startTimeUnixNano: "2000000" },
    ]),
  );
  const rep = analyzeTrace(r.spans, r.warnings);
  assert.equal(rep.roots.length, 2);
  assert.ok(rep.warnings.some((w) => w.includes("tidak ada di trace")));
});

test("a parent cycle is broken instead of hanging or overflowing the stack", () => {
  const r = parseOk(
    JSON.stringify([
      { spanId: "a", parentSpanId: "b", startTimeUnixNano: "1000000" },
      { spanId: "b", parentSpanId: "a", startTimeUnixNano: "2000000" },
    ]),
  );
  const rep = analyzeTrace(r.spans, r.warnings);
  assert.equal(rep.ordered.length, 2, "every span must still appear exactly once");
  assert.ok(rep.roots.length >= 1);
  assert.ok(rep.warnings.some((w) => w.includes("siklus")));
});

test("a self-parented span does not vanish", () => {
  const r = parseOk(JSON.stringify([{ spanId: "a", parentSpanId: "a", startTimeUnixNano: "1000000" }]));
  const rep = analyzeTrace(r.spans, r.warnings);
  assert.equal(rep.ordered.length, 1);
  assert.equal(rep.roots.length, 1);
});

test("a deep chain builds without stack overflow", () => {
  const spans: FlatSpan[] = Array.from({ length: 2000 }, (_, i) => ({
    spanId: `s${i}`,
    parentSpanId: i === 0 ? null : `s${i - 1}`,
    traceId: "t",
    name: `s${i}`,
    startUs: i,
    endUs: i + 1,
    statusCode: 1 as const,
    statusMessage: null,
    attrs: {},
  }));
  const { ordered } = buildTree(spans);
  assert.equal(ordered.length, 2000);
  assert.equal(ordered[1999].depth, 1999);
});

// ------------------------------------------------------------------ pricing

test("cache_read tokens are discounted, not double-charged", () => {
  // Per semconv, cache_read.input_tokens is *included in* input_tokens.
  const price = PRICE_TABLE["claude-sonnet-4-5"];
  const { usd } = costOf({
    model: "claude-sonnet-4-5",
    inputTokens: 1000,
    outputTokens: 0,
    cacheReadTokens: 800,
  });
  const expected = (200 / 1e6) * price.inputPerM + (800 / 1e6) * price.cacheReadPerM;
  assert.ok(Math.abs(usd - expected) < 1e-12);
  // Cheaper than charging all 1000 at full input rate.
  assert.ok(usd < (1000 / 1e6) * price.inputPerM);
});

test("cacheRead larger than input is clamped and never produces negative cost", () => {
  const { usd } = costOf({ model: "gpt-4o", inputTokens: 100, outputTokens: 0, cacheReadTokens: 999 });
  assert.ok(usd >= 0);
});

test("an unknown model is reported as unknown cost, never guessed", () => {
  const r = costOf({ model: "some-unreleased-model", inputTokens: 500, outputTokens: 100, cacheReadTokens: 0 });
  assert.equal(r.usd, 0);
  assert.equal(r.unknown, true);
  // A span with no tokens at all is not "unpriced", it is just not an LLM call.
  assert.equal(costOf({ model: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }).unknown, false);
});

test("model matching prefers the most specific key", () => {
  assert.equal(priceFor("gpt-4o-mini-2026-01"), PRICE_TABLE["gpt-4o-mini"]);
  assert.equal(priceFor("gpt-4o-2026-05"), PRICE_TABLE["gpt-4o"]);
  assert.equal(priceFor("GPT-4O-MINI"), PRICE_TABLE["gpt-4o-mini"]);
  assert.equal(priceFor(null), null);
});

// ------------------------------------------------------------------ rollups

test("token rollup sums the span attributes and flags unpriced spans", () => {
  const rep = report(FIXTURE_JSON);
  // Sums asserted against the fixture's own attribute values.
  assert.equal(rep.rollup.inputTokens, 1840 + 5200 + 9800 + 2400 + 1100);
  assert.equal(rep.rollup.outputTokens, 210 + 480 + 1200 + 320);
  assert.equal(rep.rollup.cacheReadTokens, 1200 + 1200);
  assert.equal(rep.rollup.unpricedSpans, 0, "every fixture model is in the manual price table");
  assert.ok(rep.rollup.costUsd > 0);
  // Non-LLM spans (agent/tool) legitimately carry no tokens.
  assert.equal(rep.rollup.untokenedSpans, 8);
});

test("per-operation rollup is grouped and ordered by cost", () => {
  const rep = report(FIXTURE_JSON);
  const ops = rep.byOperation.map((o) => o.operation);
  assert.deepEqual([...ops].sort(), ["chat", "embeddings", "execute_tool", "invoke_agent"]);
  const costs = rep.byOperation.map((o) => o.costUsd);
  assert.deepEqual(costs, [...costs].sort((a, b) => b - a));
  assert.equal(rep.byOperation.find((o) => o.operation === "execute_tool")!.spans, 6);
});

test("trace duration spans from earliest start to latest end", () => {
  const rep = report(FIXTURE_JSON);
  assert.equal(rep.totalDurationUs, 4820 * 1000);
  assert.equal(rep.traceEndUs - rep.traceStartUs, rep.totalDurationUs);
});

// --------------------------------------------------------------- detections

test("retry loop is detected for a tool that errors then runs again", () => {
  const rep = report(FIXTURE_JSON);
  const retries = rep.findings.filter((f) => f.id === "retry_loop");
  assert.equal(retries.length, 1, "one flapping tool should yield exactly one finding");
  assert.match(retries[0].title, /web_search/);
  assert.match(retries[0].detail, /gagal 2×/);
  // Points at both failures and the successful retry.
  assert.equal(retries[0].spanIds.length, 3);
});

test("a tool that fails on its final call is not reported as a retry loop", () => {
  const rep = report(
    JSON.stringify([
      {
        spanId: "x",
        startTimeUnixNano: "1000000000",
        endTimeUnixNano: "1100000000",
        status: { code: 2 },
        attributes: { "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "only_once" },
      },
    ]),
  );
  assert.equal(rep.findings.filter((f) => f.id === "retry_loop").length, 0);
});

test("repeated step fires at the threshold and not below it", () => {
  const rep = report(FIXTURE_JSON);
  const repeated = rep.findings.filter((f) => f.id === "repeated_step");
  // fetch_page ×3 qualifies; web_search ×3 also sits under the same agent.
  assert.ok(repeated.length >= 1);
  assert.ok(repeated.some((f) => f.title.includes("fetch_page") && f.title.includes("×3")));
  assert.equal(REPEATED_CHILD_THRESHOLD, 3);

  const below = report(
    JSON.stringify([
      {
        spanId: "p",
        startTimeUnixNano: "1000000000",
        endTimeUnixNano: "9000000000",
        attributes: { "gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": "a" },
      },
      ...[1, 2].map((i) => ({
        spanId: `c${i}`,
        parentSpanId: "p",
        startTimeUnixNano: `${1000000000 + i * 1000}`,
        endTimeUnixNano: `${1000000000 + i * 2000}`,
        attributes: { "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "same" },
      })),
    ]),
  );
  assert.equal(below.findings.filter((f) => f.id === "repeated_step").length, 0, "2 identical children is not a loop");
});

test("most expensive step identifies the real cost leader with its share", () => {
  const rep = report(FIXTURE_JSON);
  const top = rep.findings.find((f) => f.id === "most_expensive");
  assert.ok(top);
  const leader = rep.ordered.find((s) => s.spanId === top!.spanIds[0])!;
  const maxCost = Math.max(...rep.ordered.map((s) => s.costUsd));
  assert.equal(leader.costUsd, maxCost);
  assert.match(top!.detail, /% dari biaya/);
});

test("most expensive falls back to token count when no model is priced", () => {
  const rep = report(
    JSON.stringify([
      {
        spanId: "a",
        startTimeUnixNano: "1000000000",
        endTimeUnixNano: "1100000000",
        attributes: { "gen_ai.operation.name": "chat", "gen_ai.request.model": "mystery-1", "gen_ai.usage.input_tokens": 10 },
      },
      {
        spanId: "b",
        startTimeUnixNano: "1200000000",
        endTimeUnixNano: "1300000000",
        attributes: { "gen_ai.operation.name": "chat", "gen_ai.request.model": "mystery-1", "gen_ai.usage.input_tokens": 9000 },
      },
    ]),
  );
  const top = rep.findings.find((f) => f.id === "most_expensive");
  assert.ok(top);
  assert.deepEqual(top!.spanIds, ["b"]);
  assert.match(top!.detail, /% dari token/);
  assert.equal(rep.rollup.unpricedSpans, 2);
});

test("the clean fixture reports no warnings and no retry or repetition", () => {
  const rep = report(CLEAN_JSON);
  assert.equal(rep.warnings.length, 0);
  assert.equal(rep.findings.filter((f) => f.id === "retry_loop").length, 0);
  assert.equal(rep.findings.filter((f) => f.id === "repeated_step").length, 0);
  // It still surfaces the cost leader, which is informational rather than a problem.
  assert.deepEqual(
    rep.findings.map((f) => f.id),
    ["most_expensive"],
  );
});

test("a trace with no GenAI attributes at all yields no findings but still renders", () => {
  const rep = report(JSON.stringify([{ spanId: "a", name: "GET /health", startTimeUnixNano: "1000000000", endTimeUnixNano: "1050000000" }]));
  assert.equal(rep.findings.length, 0);
  assert.equal(rep.ordered.length, 1);
  assert.equal(rep.rollup.costUsd, 0);
  assert.equal(rep.byOperation[0].operation, "(tanpa gen_ai.operation.name)");
});

// ----------------------------------------------------------------- display

test("formatDuration switches unit by magnitude", () => {
  assert.equal(formatDuration(0), "0 µs");
  assert.equal(formatDuration(999), "999 µs");
  assert.equal(formatDuration(1500), "1.5 ms");
  assert.equal(formatDuration(45_000), "45 ms");
  assert.equal(formatDuration(4_820_000), "4.82 s");
});
