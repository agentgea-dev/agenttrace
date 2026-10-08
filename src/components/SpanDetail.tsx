"use client";

import { formatDuration } from "@/lib/analyze";
import { formatUsd, priceFor } from "@/lib/pricing";
import type { TraceSpan } from "@/lib/types";

const STATUS_LABEL: Record<0 | 1 | 2, string> = {
  0: "UNSET",
  1: "OK",
  2: "ERROR",
};

export default function SpanDetail({ span }: { span: TraceSpan }) {
  const attrs = Object.entries(span.attrs).sort(([a], [b]) => a.localeCompare(b));
  const priced = priceFor(span.model) !== null;
  const hasTokens = span.inputTokens > 0 || span.outputTokens > 0;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-mono text-sm text-slate-100">{span.name}</h3>
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              span.statusCode === 2
                ? "bg-red-500/20 text-red-300"
                : span.statusCode === 1
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-slate-700/60 text-slate-300"
            }`}
          >
            {STATUS_LABEL[span.statusCode]}
          </span>
        </div>
        {span.statusMessage && <p className="mt-1 text-xs text-red-300">{span.statusMessage}</p>}
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 px-3 py-3 text-xs">
        <div>
          <dt className="text-slate-500">Durasi</dt>
          <dd className="font-mono text-slate-200">{formatDuration(span.durationUs)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Kedalaman</dt>
          <dd className="font-mono text-slate-200">
            {span.depth} · {span.children.length} anak
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">gen_ai.operation.name</dt>
          <dd className="font-mono text-slate-200">{span.operation ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Model</dt>
          <dd className="truncate font-mono text-slate-200" title={span.model ?? undefined}>
            {span.model ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Token in / out</dt>
          <dd className="font-mono text-slate-200">
            {span.inputTokens.toLocaleString("id-ID")} / {span.outputTokens.toLocaleString("id-ID")}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Biaya (acuan manual)</dt>
          <dd className="font-mono text-slate-200">
            {hasTokens && !priced ? (
              <span className="text-amber-300">tidak diketahui</span>
            ) : (
              formatUsd(span.costUsd)
            )}
          </dd>
        </div>
        {(span.cacheReadTokens > 0 || span.cacheWriteTokens > 0) && (
          <div className="col-span-2">
            <dt className="text-slate-500">Cache token</dt>
            <dd className="font-mono text-slate-200">
              baca {span.cacheReadTokens.toLocaleString("id-ID")} · tulis{" "}
              {span.cacheWriteTokens.toLocaleString("id-ID")}
              <span className="ml-1 font-sans text-[11px] text-slate-500">
                (cache_read sudah termasuk di input_tokens menurut spec, jadi tidak dihitung dua kali)
              </span>
            </dd>
          </div>
        )}
        <div className="col-span-2">
          <dt className="text-slate-500">spanId / parentSpanId</dt>
          <dd className="truncate font-mono text-[11px] text-slate-300">
            {span.spanId} / {span.parentSpanId ?? "(root)"}
          </dd>
        </div>
      </dl>

      <div className="border-t border-slate-800 px-3 py-2">
        <h4 className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-500">
          Atribut mentah ({attrs.length})
        </h4>
        {attrs.length === 0 ? (
          <p className="text-xs text-slate-500">Span ini tidak membawa atribut.</p>
        ) : (
          <dl className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {attrs.map(([key, value]) => (
              <div key={key} className="flex gap-2 text-[11px] leading-relaxed">
                <dt className="w-1/2 shrink-0 break-all font-mono text-slate-400">{key}</dt>
                <dd className="break-all font-mono text-slate-200">{String(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
