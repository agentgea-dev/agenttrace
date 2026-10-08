"use client";

import { useMemo, useState } from "react";

import { analyzeTrace, formatDuration } from "@/lib/analyze";
import { CLEAN_JSON, FIXTURE_JSON, FLAT_ARRAY_JSON } from "@/lib/fixture";
import { MAX_SPANS, parseTrace } from "@/lib/parse";
import { PRICES_AS_OF, formatUsd } from "@/lib/pricing";
import type { Finding } from "@/lib/types";

import SpanDetail from "./SpanDetail";
import Waterfall, { OP_LEGEND } from "./Waterfall";

const SAMPLES = [
  { label: "Trace bermasalah (OTLP)", json: FIXTURE_JSON },
  { label: "Trace bersih (OTLP)", json: CLEAN_JSON },
  { label: "Trace bermasalah (array span)", json: FLAT_ARRAY_JSON },
];

const SEVERITY_STYLE: Record<Finding["severity"], string> = {
  warn: "border-amber-500/40 bg-amber-500/10",
  info: "border-sky-500/40 bg-sky-500/10",
};

const SEVERITY_BADGE: Record<Finding["severity"], string> = {
  warn: "bg-amber-500/20 text-amber-200",
  info: "bg-sky-500/20 text-sky-200",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 font-mono text-lg text-slate-100">{value}</div>
      {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

export default function AgentTrace() {
  const [input, setInput] = useState(FIXTURE_JSON);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeFinding, setActiveFinding] = useState<string | null>(null);

  const parsed = useMemo(() => parseTrace(input), [input]);
  const report = useMemo(
    () => (parsed.ok ? analyzeTrace(parsed.spans, parsed.warnings) : null),
    [parsed],
  );

  const selected = report?.ordered.find((s) => s.spanId === selectedId) ?? null;

  const highlightedIds = useMemo(() => {
    if (!report || !activeFinding) return new Set<string>();
    const finding = report.findings.find((f) => `${f.id}:${f.title}` === activeFinding);
    return new Set(finding?.spanIds ?? []);
  }, [report, activeFinding]);

  const loadSample = (json: string) => {
    setInput(json);
    setSelectedId(null);
    setActiveFinding(null);
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-100">AgentTrace</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Tempel satu trace OpenTelemetry dari agent LLM multi-langkah. Dapat{" "}
          <strong className="text-slate-300">waterfall timeline</strong> per langkah,{" "}
          <strong className="text-slate-300">rollup token &amp; biaya</strong>, dan{" "}
          <strong className="text-slate-300">deteksi pola buruk</strong> — retry loop, langkah
          berulang, langkah termahal. Semua perhitungan jalan di browser: nol backend, nol API key,
          nol permintaan jaringan.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Nama atribut mengikuti OpenTelemetry Semantic Conventions for Generative AI —{" "}
          <code className="text-slate-400">schema_url gen-ai-dev/1.42.0-dev</code>,{" "}
          <code className="text-slate-400">stability: development</code> (spec masih berkembang,
          bukan stabil).
        </p>
      </header>

      <section className="mb-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">Contoh:</span>
          {SAMPLES.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => loadSample(s.json)}
              className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              {s.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => loadSample("")}
            className="rounded border border-slate-800 px-2 py-1 text-xs text-slate-500 transition hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            Kosongkan
          </button>
        </div>

        <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <strong>Contoh trace di atas ditulis tangan untuk demo.</strong> Bukan telemetri
          produksi, bukan hasil pengukuran sistem nyata, dan bukan benchmark. Angka durasi dan
          token di dalamnya dikarang agar setiap detektor punya kasus uji — jangan dipakai sebagai
          data performa siapa pun.
        </div>

        <label htmlFor="trace-input" className="sr-only">
          JSON trace
        </label>
        <textarea
          id="trace-input"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setSelectedId(null);
            setActiveFinding(null);
          }}
          spellCheck={false}
          rows={10}
          placeholder={`Tempel array span OTLP atau {"resourceSpans":[...]} di sini`}
          className="w-full rounded-lg border border-slate-800 bg-slate-950/80 p-3 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-600 focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Dua bentuk input yang diterima: array span langsung, atau objek OTLP{" "}
          <code>{`{resourceSpans:[{scopeSpans:[{spans:[...]}]}]}`}</code>. Maksimum{" "}
          {MAX_SPANS.toLocaleString("id-ID")} span.
        </p>
      </section>

      {!parsed.ok && input.trim() !== "" && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
        >
          {parsed.message}
        </div>
      )}

      {report && (
        <>
          {report.warnings.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
              <strong className="mb-1 block">Catatan parsing:</strong>
              <ul className="list-inside list-disc space-y-0.5">
                {report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <section className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Span" value={report.ordered.length.toLocaleString("id-ID")} hint={`${report.roots.length} root`} />
            <Stat label="Durasi total" value={formatDuration(report.totalDurationUs)} />
            <Stat
              label="Token"
              value={(report.rollup.inputTokens + report.rollup.outputTokens).toLocaleString("id-ID")}
              hint={`${report.rollup.inputTokens.toLocaleString("id-ID")} in / ${report.rollup.outputTokens.toLocaleString("id-ID")} out`}
            />
            <Stat
              label="Biaya acuan"
              value={formatUsd(report.rollup.costUsd)}
              hint={
                report.rollup.unpricedSpans > 0
                  ? `${report.rollup.unpricedSpans} span modelnya tak ada di tabel harga`
                  : `tabel harga manual ${PRICES_AS_OF}`
              }
            />
          </section>

          <section className="mb-5">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">
              Temuan{" "}
              <span className="font-normal text-slate-500">
                ({report.findings.length})
              </span>
            </h2>
            {report.findings.length === 0 ? (
              <p className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-400">
                Tidak ada pola buruk terdeteksi oleh tiga detektor yang ada. Itu bukan jaminan
                trace ini sehat — hanya berarti ketiga pola ini tidak muncul.
              </p>
            ) : (
              <ul className="space-y-2">
                {report.findings.map((f) => {
                  const key = `${f.id}:${f.title}`;
                  const isActive = activeFinding === key;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveFinding(isActive ? null : key);
                          if (!isActive && f.spanIds[0]) setSelectedId(f.spanIds[0]);
                        }}
                        aria-pressed={isActive}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${SEVERITY_STYLE[f.severity]} ${isActive ? "ring-1 ring-slate-400/50" : ""}`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEVERITY_BADGE[f.severity]}`}
                          >
                            {f.severity === "warn" ? "Masalah" : "Info"}
                          </span>
                          <span className="text-sm font-medium text-slate-100">{f.title}</span>
                          <span className="ml-auto text-[11px] text-slate-400">
                            {f.spanIds.length} span · {isActive ? "sembunyikan" : "sorot"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-slate-300">{f.detail}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="mb-5">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold text-slate-200">Waterfall</h2>
              {OP_LEGEND.map(([op, color]) => (
                <span key={op} className="flex items-center gap-1 text-[11px] text-slate-400">
                  <span className={`inline-block h-2 w-2 rounded-sm ${color}`} />
                  {op}
                </span>
              ))}
              <span className="flex items-center gap-1 text-[11px] text-slate-400">
                <span className="inline-block h-2 w-2 rounded-sm bg-red-500" />
                status error
              </span>
            </div>
            <Waterfall
              spans={report.ordered}
              traceStartUs={report.traceStartUs}
              totalDurationUs={report.totalDurationUs}
              selectedId={selectedId}
              highlightedIds={highlightedIds}
              onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Klik satu baris untuk melihat atribut mentahnya. Lebar bar = durasi relatif terhadap
              total trace; indentasi = kedalaman pohon dari <code>parentSpanId</code>.
            </p>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section>
              <h2 className="mb-2 text-sm font-semibold text-slate-200">Rollup per operasi</h2>
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-xs">
                  <thead className="bg-slate-900/60 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-normal">gen_ai.operation.name</th>
                      <th className="px-2 py-1.5 text-right font-normal">Span</th>
                      <th className="px-2 py-1.5 text-right font-normal">In</th>
                      <th className="px-2 py-1.5 text-right font-normal">Out</th>
                      <th className="px-2 py-1.5 text-right font-normal">Biaya</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {report.byOperation.map((row) => (
                      <tr key={row.operation}>
                        <td className="px-2 py-1.5 font-mono text-slate-200">{row.operation}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">{row.spans}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">
                          {row.inputTokens.toLocaleString("id-ID")}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-300">
                          {row.outputTokens.toLocaleString("id-ID")}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-200">
                          {formatUsd(row.costUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                Biaya dihitung dari <strong>tabel harga yang diisi tangan</strong>, acuan per{" "}
                <strong>{PRICES_AS_OF}</strong> — bukan harga real-time dan bukan tagihan. Tidak
                ada API harga yang dipanggil. Model yang tidak ada di tabel dilaporkan{" "}
                <em>tidak diketahui</em>, bukan ditaksir. Token dibaca apa adanya dari atribut{" "}
                <code>gen_ai.usage.*</code>; tidak ada tokenizer yang menghitung ulang.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-slate-200">Detail span</h2>
              {selected ? (
                <SpanDetail span={selected} />
              ) : (
                <p className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-400">
                  Pilih satu baris di waterfall untuk melihat atribut mentahnya.
                </p>
              )}
            </section>
          </div>

          <footer className="mt-8 border-t border-slate-800 pt-4 text-[11px] leading-relaxed text-slate-500">
            <p className="mb-1">
              <strong className="text-slate-400">Batasannya, apa adanya:</strong> tiga detektor
              saja (retry loop, langkah berulang, langkah termahal) — bukan analisis menyeluruh.
              Input hanya lewat tempel; tidak ada collector OTLP, tidak ada gRPC, tidak terhubung
              ke backend trace apa pun. Biaya memakai tabel harga manual yang akan basi. Spec GenAI
              yang diikuti berstatus <code>development</code>, jadi nama atribut masih bisa berubah.
            </p>
          </footer>
        </>
      )}
    </main>
  );
}
