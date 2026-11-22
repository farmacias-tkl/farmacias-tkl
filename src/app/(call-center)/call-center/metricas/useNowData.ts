"use client";

import { useCallback, useEffect, useState } from "react";
import { NOW_CACHE_SECONDS, type NowPayload } from "@/lib/call-center/metrics/now-types";

export type NowState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: NowPayload };

/** Carga /api/call-center/metrics/now y la refresca sola. La usan "Ahora" y "Calidad de datos". */
export function useNowData(): { state: NowState; refreshing: boolean; reload: () => void } {
  const [state, setState] = useState<NowState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/call-center/metrics/now", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) {
        // Si ya había datos en pantalla se conservan: un refresco fallido no los borra.
        setState((prev) => (prev.status === "ready" ? prev : { status: "error", message: body?.error ?? "No se pudieron cargar las métricas." }));
        return;
      }
      setState({ status: "ready", data: body.data as NowPayload });
    } catch {
      setState((prev) => (prev.status === "ready" ? prev : { status: "error", message: "No se pudieron cargar las métricas. Revisá la conexión." }));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, NOW_CACHE_SECONDS * 1000);
    return () => clearInterval(id);
  }, [load]);

  return { state, refreshing, reload: load };
}
