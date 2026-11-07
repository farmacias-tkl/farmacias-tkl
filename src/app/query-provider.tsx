"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => {
    const c = new QueryClient({
      // gcTime: al volver a una pantalla se ve lo que ya estaba mientras se actualiza.
      defaultOptions: { queries: { staleTime: 60_000, gcTime: 30 * 60_000, retry: 1 } },
    });
    // Catálogos: cambian poco. Crear o editar uno invalida su clave.
    for (const key of ["branches", "branches-list", "positions", "positions-list"]) {
      c.setQueryDefaults([key], { staleTime: 10 * 60_000 });
    }
    return c;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
