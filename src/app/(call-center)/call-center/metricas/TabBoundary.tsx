"use client";

import { Component, type ReactNode } from "react";

/**
 * Barrera de errores de una pestaña de métricas: si algo falla al mostrarla, se ve el aviso
 * con "Reintentar" en lugar de una pantalla en blanco o un "Cargando…" que no termina.
 * Las demás pestañas y el menú siguen funcionando.
 */
export default class TabBoundary extends Component<{ children: ReactNode }, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Solo el nombre del error: nunca datos de la pantalla.
    console.error("[call-center/metricas] error al mostrar la pestaña", error instanceof Error ? error.name : "error");
  }

  render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          No se pudo mostrar esta pestaña.{" "}
          <button type="button" onClick={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))} className="font-medium underline">Reintentar</button>
        </div>
      );
    }
    // La clave cambia en cada reintento: la pestaña se monta de nuevo y vuelve a pedir sus datos.
    return <div key={this.state.attempt}>{this.props.children}</div>;
  }
}
