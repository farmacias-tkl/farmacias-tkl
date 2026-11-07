// Esqueletos de carga. Se ven al instante al tocar un ítem del menú, mientras
// llega la pantalla.

function Block({ className }: { className: string }) {
  return <div className={`rounded bg-gray-200 animate-pulse ${className}`} />;
}

function Header() {
  return (
    <div className="space-y-2">
      <Block className="h-5 w-40" />
      <Block className="h-4 w-56 max-w-full bg-gray-100" />
    </div>
  );
}

/** Pantalla con filtros y una lista. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-4" role="status" aria-label="Cargando">
      <Header />
      <Block className="h-10 w-full max-w-md" />
      <div className="card divide-y divide-gray-100">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex gap-3 px-4 py-3">
            <Block className="w-8 h-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5 py-0.5">
              <Block className="h-3.5 w-2/3 max-w-[240px]" />
              <Block className="h-3 w-1/2 max-w-[160px] bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Pantalla de tarjetas (Sucursales). */
export function CardsSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="space-y-5" role="status" aria-label="Cargando">
      <Header />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="card p-4 space-y-3">
            <Block className="h-4 w-3/5" />
            <Block className="h-3 w-4/5 bg-gray-100" />
            <Block className="h-3 w-1/3 bg-gray-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Dashboard: tarjetas de resumen y detalle. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Cargando">
      <Header />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card p-5 space-y-3">
            <Block className="h-8 w-8 rounded-lg" />
            <Block className="h-6 w-10" />
            <Block className="h-3 w-3/4 bg-gray-100" />
          </div>
        ))}
      </div>
      <Block className="h-24 w-full rounded-xl" />
    </div>
  );
}

/** Ficha: cabecera, resumen y contenido. */
export function DetailSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Cargando">
      <Block className="h-4 w-24" />
      <div className="card p-5 space-y-3">
        <Block className="h-5 w-48 max-w-full" />
        <Block className="h-4 w-64 max-w-full bg-gray-100" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Block key={i} className="h-20 rounded-xl" />)}
      </div>
      <Block className="h-48 w-full rounded-xl" />
    </div>
  );
}
