"use client";

import { formatDuration } from "@/lib/analyze";
import { formatUsd } from "@/lib/pricing";
import type { TraceSpan } from "@/lib/types";

/**
 * Waterfall timeline. Pure CSS — no chart library.
 *
 * Each row's bar is absolutely positioned inside a percentage-width track:
 *   left  = (span.start - trace.start) / trace.duration
 *   width = span.duration / trace.duration
 * Indentation comes from tree depth, so nesting reads vertically while timing
 * reads horizontally.
 */

const OP_COLOR: Record<string, string> = {
  invoke_agent: "bg-violet-500",
  chat: "bg-sky-500",
  execute_tool: "bg-emerald-500",
  embeddings: "bg-amber-500",
  retrieval: "bg-teal-500",
  invoke_workflow: "bg-indigo-500",
  plan: "bg-fuchsia-500",
};

function barColor(span: TraceSpan): string {
  if (span.statusCode === 2) return "bg-red-500";
  return OP_COLOR[span.operation ?? ""] ?? "bg-slate-500";
}

export const OP_LEGEND = Object.entries(OP_COLOR);

interface Props {
  spans: TraceSpan[];
  traceStartUs: number;
  totalDurationUs: number;
  selectedId: string | null;
  highlightedIds: Set<string>;
  onSelect: (spanId: string) => void;
}

export default function Waterfall({
  spans,
  traceStartUs,
  totalDurationUs,
  selectedId,
  highlightedIds,
  onSelect,
}: Props) {
  // A zero-duration trace (all spans instantaneous) would divide by zero.
  const span1 = totalDurationUs > 0 ? totalDurationUs : 1;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800">
      <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400">
        <span className="w-[42%] min-w-0">Span</span>
        <span className="flex-1">
          Timeline — total {formatDuration(totalDurationUs)}
        </span>
      </div>

      <ul className="divide-y divide-slate-800/60">
        {spans.map((span) => {
          const leftPct = ((span.startUs - traceStartUs) / span1) * 100;
          const widthPct = (span.durationUs / span1) * 100;
          const isSelected = selectedId === span.spanId;
          const isHighlighted = highlightedIds.has(span.spanId);
          const tokens = span.inputTokens + span.outputTokens;

          return (
            <li key={span.spanId}>
              <button
                type="button"
                onClick={() => onSelect(span.spanId)}
                aria-current={isSelected ? "true" : undefined}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-slate-800/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                  isSelected ? "bg-slate-800/80" : isHighlighted ? "bg-amber-500/10" : ""
                }`}
              >
                <span className="flex w-[42%] min-w-0 items-center gap-1.5">
                  <span aria-hidden="true" style={{ width: span.depth * 14 }} className="shrink-0" />
                  {span.statusCode === 2 && (
                    <span
                      className="shrink-0 rounded bg-red-500/20 px-1 text-[10px] font-semibold text-red-300"
                      title={span.statusMessage ?? "status error"}
                    >
                      ERR
                    </span>
                  )}
                  <span className="truncate font-mono text-xs text-slate-200">{span.name}</span>
                </span>

                <span className="relative h-5 flex-1 rounded bg-slate-900/80">
                  <span
                    className={`absolute inset-y-0.5 rounded ${barColor(span)}`}
                    style={{
                      left: `${Math.min(leftPct, 100)}%`,
                      // Keep a hairline visible for zero-duration spans.
                      width: `max(2px, ${Math.min(widthPct, 100 - Math.min(leftPct, 100))}%)`,
                    }}
                  />
                  <span className="absolute inset-y-0 right-1 flex items-center gap-2 text-[10px] text-slate-400">
                    {tokens > 0 && <span>{tokens.toLocaleString("id-ID")} tok</span>}
                    {span.costUsd > 0 && <span className="text-slate-300">{formatUsd(span.costUsd)}</span>}
                    <span className="tabular-nums">{formatDuration(span.durationUs)}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
