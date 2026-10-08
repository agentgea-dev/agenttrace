import { costOf } from "./pricing.ts";
import type { AttrMap, Finding, FlatSpan, TokenRollup, TraceReport, TraceSpan } from "./types.ts";

/** >= this many identical children under one invoke_agent span triggers "repeated step". */
export const REPEATED_CHILD_THRESHOLD = 3;

function num(attrs: AttrMap, key: string): number {
  const v = attrs[key];
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  return 0;
}

function str(attrs: AttrMap, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = attrs[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

/**
 * Derive the GenAI semconv fields we care about.
 * Token attrs: `gen_ai.usage.input_tokens` / `output_tokens` (recommended level),
 * plus the cache breakdown which the spec says is *included in* input_tokens.
 */
function enrich(span: FlatSpan, depth: number): TraceSpan {
  const a = span.attrs;
  const inputTokens = num(a, "gen_ai.usage.input_tokens");
  const outputTokens = num(a, "gen_ai.usage.output_tokens");
  const cacheReadTokens = num(a, "gen_ai.usage.cache_read.input_tokens");
  const cacheWriteTokens = num(a, "gen_ai.usage.cache_write.input_tokens");
  const model = str(a, "gen_ai.request.model", "gen_ai.response.model");
  const { usd, unknown } = costOf({ model, inputTokens, outputTokens, cacheReadTokens });

  return {
    ...span,
    depth,
    children: [],
    operation: str(a, "gen_ai.operation.name"),
    toolName: str(a, "gen_ai.tool.name"),
    agentName: str(a, "gen_ai.agent.name"),
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costUsd: usd,
    costUnknown: unknown,
    durationUs: Math.max(0, span.endUs - span.startUs),
  };
}

/**
 * Build the span forest from `parentSpanId`.
 *
 * Two hazards handled explicitly:
 *  - a parent id that points at no known span → the span is promoted to a root
 *  - a parent cycle (a → b → a) → the cycle is broken by promoting one member
 * Both are reported as warnings rather than throwing.
 */
export function buildTree(spans: FlatSpan[]): { roots: TraceSpan[]; ordered: TraceSpan[]; warnings: string[] } {
  const warnings: string[] = [];
  const byId = new Map<string, FlatSpan>();
  for (const s of spans) byId.set(s.spanId, s);

  let orphaned = 0;
  let cyclic = 0;

  /** Resolve the effective parent, treating unknown ids and cycles as "no parent". */
  const effectiveParent = new Map<string, string | null>();
  for (const s of spans) {
    let parent = s.parentSpanId;
    if (parent !== null && !byId.has(parent)) {
      orphaned++;
      parent = null;
    }
    if (parent !== null) {
      // Walk up; if we come back to this span, the chain is cyclic.
      const seen = new Set<string>([s.spanId]);
      let cursor: string | null = parent;
      while (cursor !== null) {
        if (seen.has(cursor)) {
          cyclic++;
          parent = null;
          break;
        }
        seen.add(cursor);
        const next = byId.get(cursor);
        cursor = next && next.parentSpanId !== null && byId.has(next.parentSpanId) ? next.parentSpanId : null;
      }
    }
    effectiveParent.set(s.spanId, parent);
  }

  if (orphaned) warnings.push(`${orphaned} span punya parentSpanId yang tidak ada di trace — dinaikkan jadi root.`);
  if (cyclic) warnings.push(`${cyclic} span membentuk siklus parent — rantainya diputus.`);

  const nodes = new Map<string, TraceSpan>();
  for (const s of spans) nodes.set(s.spanId, enrich(s, 0));

  const roots: TraceSpan[] = [];
  for (const s of spans) {
    const node = nodes.get(s.spanId)!;
    const parentId = effectiveParent.get(s.spanId) ?? null;
    if (parentId === null) roots.push(node);
    else nodes.get(parentId)!.children.push(node);
  }

  const byStart = (a: TraceSpan, b: TraceSpan) => a.startUs - b.startUs || a.name.localeCompare(b.name);
  roots.sort(byStart);

  // Assign depth and produce the depth-first row order used by the waterfall.
  const ordered: TraceSpan[] = [];
  const walk = (node: TraceSpan, depth: number) => {
    node.depth = depth;
    ordered.push(node);
    node.children.sort(byStart);
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);

  return { roots, ordered, warnings };
}

function rollupOf(spans: TraceSpan[]): TokenRollup {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let costUsd = 0;
  let unpricedSpans = 0;
  let untokenedSpans = 0;

  for (const s of spans) {
    inputTokens += s.inputTokens;
    outputTokens += s.outputTokens;
    cacheReadTokens += s.cacheReadTokens;
    cacheWriteTokens += s.cacheWriteTokens;
    costUsd += s.costUsd;
    if (s.costUnknown) unpricedSpans++;
    if (s.inputTokens === 0 && s.outputTokens === 0) untokenedSpans++;
  }

  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd, unpricedSpans, untokenedSpans };
}

function byOperationOf(spans: TraceSpan[]) {
  const map = new Map<string, { operation: string; spans: number; inputTokens: number; outputTokens: number; costUsd: number }>();
  for (const s of spans) {
    const key = s.operation ?? "(tanpa gen_ai.operation.name)";
    const row = map.get(key) ?? { operation: key, spans: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    row.spans++;
    row.inputTokens += s.inputTokens;
    row.outputTokens += s.outputTokens;
    row.costUsd += s.costUsd;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.costUsd - a.costUsd || b.spans - a.spans);
}

/**
 * Detection 1 — retry loop.
 * An `execute_tool` span that ended in error (status code 2), where the same
 * tool name is invoked again later anywhere in the trace. That later call is
 * the retry. Grouped per tool name so one finding covers one flapping tool.
 */
function detectRetryLoops(spans: TraceSpan[]): Finding[] {
  const tools = new Map<string, TraceSpan[]>();
  for (const s of spans) {
    if (s.operation !== "execute_tool") continue;
    const name = s.toolName ?? s.name;
    const list = tools.get(name) ?? [];
    list.push(s);
    tools.set(name, list);
  }

  const findings: Finding[] = [];
  for (const [name, calls] of tools) {
    const inOrder = [...calls].sort((a, b) => a.startUs - b.startUs);
    const failed = inOrder.filter((s) => s.statusCode === 2);
    if (!failed.length) continue;
    // Only count it as a retry if a call starts after a failed call started.
    const firstFailureAt = failed[0].startUs;
    const retries = inOrder.filter((s) => s.startUs > firstFailureAt);
    if (!retries.length) continue;

    const wastedUs = failed.reduce((acc, s) => acc + s.durationUs, 0);
    findings.push({
      id: "retry_loop",
      severity: "warn",
      title: `Retry loop: ${name}`,
      detail:
        `Tool \`${name}\` gagal ${failed.length}× (status error) lalu dipanggil ulang ` +
        `${retries.length}× setelahnya. Total ${(wastedUs / 1000).toFixed(1)} ms terbuang di ` +
        `percobaan yang gagal. Penyebab lazim: argumen tool salah bentuk, atau error upstream ` +
        `yang diulang tanpa backoff.`,
      // A failed call can also be a retry of an earlier failure, so de-duplicate.
      spanIds: [...new Set([...failed, ...retries].map((s) => s.spanId))],
    });
  }
  return findings;
}

/**
 * Detection 2 — repeated step.
 * An `invoke_agent` span whose direct children repeat the same identity
 * (operation + tool/model) at least REPEATED_CHILD_THRESHOLD times. Signals an
 * agent looping over the same action instead of progressing.
 */
function detectRepeatedSteps(spans: TraceSpan[]): Finding[] {
  const findings: Finding[] = [];
  for (const parent of spans) {
    if (parent.operation !== "invoke_agent" || parent.children.length < REPEATED_CHILD_THRESHOLD) continue;

    const groups = new Map<string, TraceSpan[]>();
    for (const child of parent.children) {
      const key = `${child.operation ?? child.name}::${child.toolName ?? child.model ?? ""}`;
      const list = groups.get(key) ?? [];
      list.push(child);
      groups.set(key, list);
    }

    for (const [, group] of groups) {
      if (group.length < REPEATED_CHILD_THRESHOLD) continue;
      const label = group[0].toolName ?? group[0].operation ?? group[0].name;
      findings.push({
        id: "repeated_step",
        severity: "warn",
        title: `Langkah berulang: ${label} ×${group.length}`,
        detail:
          `Agent \`${parent.agentName ?? parent.name}\` memanggil \`${label}\` ${group.length}× ` +
          `berturut sebagai anak langsung dari satu span invoke_agent. Kalau hasilnya sama tiap ` +
          `kali, ini iterasi yang tidak maju — kandidat caching atau perbaikan prompt/stop-condition.`,
        spanIds: group.map((s) => s.spanId),
      });
    }
  }
  return findings;
}

/**
 * Detection 3 — most expensive step.
 * Ranks by USD when any span is priced, otherwise by total tokens, so the
 * finding still works for models missing from the manual price table.
 */
function detectMostExpensive(spans: TraceSpan[]): Finding[] {
  const withTokens = spans.filter((s) => s.inputTokens > 0 || s.outputTokens > 0);
  if (!withTokens.length) return [];

  const anyPriced = withTokens.some((s) => s.costUsd > 0);
  const ranked = [...withTokens].sort((a, b) =>
    anyPriced
      ? b.costUsd - a.costUsd
      : b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
  );
  const top = ranked[0];
  const totalCost = withTokens.reduce((acc, s) => acc + s.costUsd, 0);
  const totalTokens = withTokens.reduce((acc, s) => acc + s.inputTokens + s.outputTokens, 0);
  const topTokens = top.inputTokens + top.outputTokens;
  const share = anyPriced
    ? totalCost > 0
      ? (top.costUsd / totalCost) * 100
      : 0
    : totalTokens > 0
      ? (topTokens / totalTokens) * 100
      : 0;

  return [
    {
      id: "most_expensive",
      severity: "info",
      title: `Langkah termahal: ${top.name}`,
      detail:
        `Span ini ${share.toFixed(0)}% dari ${anyPriced ? "biaya" : "token"} seluruh trace ` +
        `(${top.inputTokens.toLocaleString("id-ID")} in / ${top.outputTokens.toLocaleString("id-ID")} out` +
        `${top.model ? `, model ${top.model}` : ""}). ` +
        `Optimasi di sini berdampak paling besar.`,
      spanIds: [top.spanId],
    },
  ];
}

export function analyzeTrace(spans: FlatSpan[], parseWarnings: string[] = []): TraceReport {
  const { roots, ordered, warnings } = buildTree(spans);

  const traceStartUs = Math.min(...ordered.map((s) => s.startUs));
  const traceEndUs = Math.max(...ordered.map((s) => s.endUs));

  return {
    roots,
    ordered,
    traceStartUs,
    traceEndUs,
    totalDurationUs: Math.max(0, traceEndUs - traceStartUs),
    rollup: rollupOf(ordered),
    byOperation: byOperationOf(ordered),
    findings: [...detectRetryLoops(ordered), ...detectRepeatedSteps(ordered), ...detectMostExpensive(ordered)],
    warnings: [...parseWarnings, ...warnings],
  };
}

export function formatDuration(us: number): string {
  if (us < 1000) return `${us} µs`;
  const ms = us / 1000;
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
