import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentTrace — Pembaca Jejak Eksekusi Agent LLM (OTel GenAI)",
  description:
    "Tempel satu trace OpenTelemetry dari agent multi-langkah: dapat waterfall timeline per langkah, rollup token & biaya, dan deteksi retry loop / langkah berulang / langkah termahal. Nol backend, nol API key.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
