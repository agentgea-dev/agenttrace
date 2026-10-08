import type { AttrMap, AttrValue, FlatSpan, ParseResult } from "./types.ts";

export const MAX_INPUT_CHARS = 2_000_000;
export const MAX_SPANS = 5_000;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * OTLP encodes timestamps as uint64 nanoseconds, which exceeds Number.MAX_SAFE_INTEGER
 * when expressed in ns since epoch (~1.7e18 vs 9.0e15). JSON OTLP therefore sends them
 * as strings. We parse with BigInt and divide down to microseconds, which is safely
 * representable (~1.7e15) and still finer than any realistic span duration.
 */
export function nanoToMicros(v: unknown): number | null {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return null;
    return Math.floor(v / 1000);
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d+$/.test(s)) return null;
  try {
    const us = BigInt(s) / 1000n;
    const n = Number(us);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Unwrap an OTLP `AnyValue` (`{stringValue}`, `{intValue}`, ...) or a plain JSON value. */
export function readAttrValue(raw: unknown): AttrValue | null {
  if (typeof raw === "string" || typeof raw === "boolean") return raw;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (!isRecord(raw)) return null;

  if (typeof raw.stringValue === "string") return raw.stringValue;
  if (typeof raw.boolValue === "boolean") return raw.boolValue;
  for (const key of ["intValue", "doubleValue"] as const) {
    const v = raw[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  if (isRecord(raw.arrayValue) && Array.isArray(raw.arrayValue.values)) {
    const parts = raw.arrayValue.values.map(readAttrValue).filter((x) => x !== null);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

/** Accepts OTLP `[{key, value}]` and plain `{key: value}` attribute shapes. */
export function readAttrs(raw: unknown): AttrMap {
  const out: AttrMap = {};
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!isRecord(entry) || typeof entry.key !== "string") continue;
      const v = readAttrValue(entry.value);
      if (v !== null) out[entry.key] = v;
    }
    return out;
  }
  if (isRecord(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      const parsed = readAttrValue(v);
      if (parsed !== null) out[k] = parsed;
    }
  }
  return out;
}

function readStatus(raw: unknown): { code: 0 | 1 | 2; message: string | null } {
  if (!isRecord(raw)) return { code: 0, message: null };
  const message = typeof raw.message === "string" && raw.message.trim() ? raw.message.trim() : null;
  const c = raw.code;
  // OTLP JSON allows the numeric enum or the string form.
  if (c === 2 || c === "STATUS_CODE_ERROR" || c === "ERROR") return { code: 2, message };
  if (c === 1 || c === "STATUS_CODE_OK" || c === "OK") return { code: 1, message };
  return { code: 0, message };
}

/** Collect spans out of either `{resourceSpans:[...]}` OTLP or a bare span array. */
function collectRawSpans(root: unknown): unknown[] | null {
  if (Array.isArray(root)) return root;
  if (!isRecord(root)) return null;

  const rs = root.resourceSpans;
  if (Array.isArray(rs)) {
    const out: unknown[] = [];
    for (const resource of rs) {
      if (!isRecord(resource)) continue;
      // Current field is `scopeSpans`; `instrumentationLibrarySpans` is the legacy name.
      const scopes = Array.isArray(resource.scopeSpans)
        ? resource.scopeSpans
        : Array.isArray(resource.instrumentationLibrarySpans)
          ? resource.instrumentationLibrarySpans
          : [];
      for (const scope of scopes) {
        if (!isRecord(scope) || !Array.isArray(scope.spans)) continue;
        out.push(...scope.spans);
      }
    }
    return out;
  }
  if (Array.isArray(root.spans)) return root.spans;
  return null;
}

function readId(raw: unknown): string | null {
  if (typeof raw === "string") {
    const s = raw.trim();
    // An all-zero span id means "no parent" in the OTLP wire format.
    return s && !/^0+$/.test(s) ? s : null;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
}

export function parseTrace(input: string): ParseResult {
  if (!input.trim()) {
    return { ok: false, code: "empty", message: "Tempel JSON trace terlebih dahulu." };
  }
  if (input.length > MAX_INPUT_CHARS) {
    return {
      ok: false,
      code: "too_large",
      message: `Input ${input.length.toLocaleString("id-ID")} karakter melebihi batas ${MAX_INPUT_CHARS.toLocaleString("id-ID")}.`,
    };
  }

  let root: unknown;
  try {
    root = JSON.parse(input);
  } catch (err) {
    return {
      ok: false,
      code: "bad_json",
      message: `JSON tidak valid: ${err instanceof Error ? err.message : "gagal diparse"}`,
    };
  }

  if (root === null || typeof root !== "object") {
    return {
      ok: false,
      code: "not_object",
      message: "Trace harus berupa array span atau objek OTLP `{resourceSpans:[...]}`.",
    };
  }

  const rawSpans = collectRawSpans(root);
  if (rawSpans === null) {
    return {
      ok: false,
      code: "no_spans",
      message: "Tidak menemukan span. Dukungan terbatas pada array span atau `{resourceSpans:[...]}`.",
    };
  }
  if (rawSpans.length > MAX_SPANS) {
    return {
      ok: false,
      code: "too_many_spans",
      message: `${rawSpans.length.toLocaleString("id-ID")} span melebihi batas ${MAX_SPANS.toLocaleString("id-ID")}.`,
    };
  }

  const warnings: string[] = [];
  const spans: FlatSpan[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  let synthesized = 0;

  rawSpans.forEach((raw, i) => {
    if (!isRecord(raw)) {
      dropped++;
      return;
    }
    const startUs = nanoToMicros(raw.startTimeUnixNano ?? raw.startTimeUnixNanos ?? raw.startTime);
    const endRaw = nanoToMicros(raw.endTimeUnixNano ?? raw.endTimeUnixNanos ?? raw.endTime);
    if (startUs === null) {
      dropped++;
      return;
    }
    // A span with no/invalid end time is treated as zero-duration rather than dropped:
    // in-flight spans are common in exported traces and still carry useful attributes.
    let endUs = endRaw;
    if (endUs === null || endUs < startUs) {
      endUs = startUs;
      synthesized++;
    }

    let spanId = readId(raw.spanId) ?? readId(raw.span_id);
    if (!spanId || seen.has(spanId)) {
      // Duplicate or missing ids would silently collapse tree nodes, so give them
      // a stable synthetic id derived from position instead.
      spanId = `__span_${i}`;
      if (seen.has(spanId)) spanId = `__span_${i}_${spans.length}`;
    }
    seen.add(spanId);

    const status = readStatus(raw.status);
    const attrs = readAttrs(raw.attributes);

    spans.push({
      spanId,
      parentSpanId: readId(raw.parentSpanId) ?? readId(raw.parent_span_id),
      traceId: readId(raw.traceId) ?? readId(raw.trace_id),
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "(tanpa nama)",
      startUs,
      endUs,
      statusCode: status.code,
      statusMessage: status.message,
      attrs,
    });
  });

  if (dropped) warnings.push(`${dropped} entri dilewati: bukan objek span atau tanpa startTimeUnixNano yang valid.`);
  if (synthesized) warnings.push(`${synthesized} span tanpa endTimeUnixNano valid dianggap berdurasi 0.`);

  if (!spans.length) {
    return {
      ok: false,
      code: "no_valid_spans",
      message: "Tidak ada span valid. Setiap span butuh `startTimeUnixNano`.",
    };
  }

  return { ok: true, spans, warnings };
}
