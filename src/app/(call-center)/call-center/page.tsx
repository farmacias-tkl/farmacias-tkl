export const metadata = { title: "Call Center — Farmacias TKL" };

// Placeholder de la fundación: el dominio existe y está gateado (canViewCallCenter
// en middleware + layout SSR). Las funcionalidades (conversaciones, IA, safety,
// Emozion, WhatsApp) llegan en fases posteriores, cada una con su propia Fase A.
export default function CallCenterPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>Call Center</h1>
      <p style={{ marginTop: 12, color: "#6b7280", fontSize: 14, lineHeight: 1.6 }}>
        Módulo en construcción. La fundación —acceso gateado por rol o flag— está activa.
        Las funcionalidades (conversaciones, IA, WhatsApp) se incorporan en fases posteriores.
      </p>
    </main>
  );
}
