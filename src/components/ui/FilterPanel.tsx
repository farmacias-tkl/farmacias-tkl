"use client";
import { useEffect, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** Cuántos filtros hay aplicados. Se muestra en el botón. */
  activeCount: number;
  onClear?: () => void;
  children: React.ReactNode;
}

/**
 * En celular, los filtros quedan detrás de un botón "Filtros (n)" que abre un
 * panel. Desde md los hijos se ven en línea, como parte del contenedor del padre.
 * Los hijos se dibujan una sola vez en ambos casos.
 */
export function FilterPanel({ activeCount, onClear, children }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-expanded={open}
        className="btn-secondary w-full justify-center md:hidden">
        <SlidersHorizontal className="w-4 h-4" />
        Filtros
        {activeCount > 0 && (
          <span className="rounded-full bg-blue-700 px-2 text-xs font-semibold text-white">{activeCount}</span>
        )}
      </button>

      {open && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)} />}

      <div className={cn(
        "md:contents",
        open
          ? "filter-sheet fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          : "hidden",
      )}>
        <div className="flex items-center justify-between md:hidden">
          <h3 className="text-sm font-semibold text-gray-900">Filtros</h3>
          <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar filtros"
            className="flex items-center justify-center text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
        <div className="flex gap-2 md:hidden">
          {onClear && (
            <button type="button" onClick={onClear} disabled={activeCount === 0} className="btn-secondary flex-1 justify-center">
              Limpiar
            </button>
          )}
          <button type="button" onClick={() => setOpen(false)} className="btn-primary flex-1 justify-center">
            Ver resultados
          </button>
        </div>
      </div>
    </>
  );
}
