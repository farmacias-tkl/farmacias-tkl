"use client";
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

interface Employee {
  id:        string;
  firstName: string;
  lastName:  string;
  position?: { name: string } | null;
  currentBranch?: { name: string } | null;
}

interface Props {
  value:        string;       // employeeId seleccionado
  valueLabel?:  string;       // label visible cuando hay selección
  onChange:     (employeeId: string, employee: Employee | null) => void;
  placeholder?: string;
  /** Si está presente, restringe la búsqueda a esa sucursal. */
  branchId?:    string;
}

export default function EmployeeSearchInput({
  value, valueLabel, onChange, placeholder = "Buscar por nombre o apellido...", branchId,
}: Props) {
  const [query,   setQuery]   = useState("");
  const [open,    setOpen]    = useState(false);
  const [results, setResults] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Debounce 250ms
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams({ search: query.trim(), limit: "20" });
        if (branchId) p.set("branchId", branchId);
        const res = await fetch(`/api/employees?${p}`);
        const json = await res.json();
        setResults(json.data ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, branchId]);

  // Click fuera para cerrar el dropdown
  useEffect(() => {
    if (!open) return;
    const onClickOut = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOut);
    return () => document.removeEventListener("mousedown", onClickOut);
  }, [open]);

  const clear = () => {
    setQuery("");
    setResults([]);
    onChange("", null);
  };

  // Si hay una selección activa, mostrar como chip
  if (value && valueLabel) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs">
        <span className="font-medium text-blue-900">{valueLabel}</span>
        <button
          type="button"
          onClick={clear}
          className="text-blue-500 hover:text-blue-800"
          aria-label="Quitar filtro de empleado"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative w-full sm:w-64">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="input pl-8 w-full"
        />
      </div>

      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto z-30">
          {loading && (
            <div className="px-3 py-2 text-xs text-gray-400">Buscando...</div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">Sin resultados.</div>
          )}
          {!loading && results.map((e) => (
            <button
              key={e.id}
              type="button"
              onMouseDown={() => {
                onChange(e.id, e);
                setOpen(false);
                setQuery("");
              }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs border-b border-gray-100 last:border-b-0"
            >
              <div className="font-medium text-gray-900">{e.firstName} {e.lastName}</div>
              <div className="text-gray-500 mt-0.5">
                {e.position?.name ?? "Sin puesto"}
                {e.currentBranch?.name && ` · ${e.currentBranch.name}`}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
