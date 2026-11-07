// Filas de indicadores (KPI) de la plataforma operativa.
// En celular y tablet: 2 columnas iguales, misma altura por fila y, si queda
// una tarjeta sola al final, ocupa el ancho completo (regla .kpi-grid en
// globals.css). En escritorio: `cols` columnas.
// Los rótulos largos pasan a dos líneas; nunca se cortan con "…".
import Link from "next/link";
import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

const LG_COLS = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" } as const;

export function KpiGrid({ cols = 4, className, children }: {
  cols?: keyof typeof LG_COLS; className?: string; children: ReactNode;
}) {
  return <div className={cn("kpi-grid grid grid-cols-2 gap-3", LG_COLS[cols], className)}>{children}</div>;
}

export type KpiTone = "blue" | "teal" | "orange" | "red" | "green" | "amber" | "violet" | "indigo" | "yellow" | "gray";

const TONE: Record<KpiTone, { bg: string; text: string; ring: string }> = {
  blue:   { bg: "bg-blue-50",   text: "text-blue-600",   ring: "ring-2 ring-blue-400" },
  teal:   { bg: "bg-teal-50",   text: "text-teal-600",   ring: "ring-2 ring-teal-400" },
  orange: { bg: "bg-orange-50", text: "text-orange-500", ring: "ring-2 ring-orange-400" },
  red:    { bg: "bg-red-50",    text: "text-red-500",    ring: "ring-2 ring-red-400" },
  green:  { bg: "bg-green-50",  text: "text-green-600",  ring: "ring-2 ring-green-400" },
  amber:  { bg: "bg-amber-50",  text: "text-amber-600",  ring: "ring-2 ring-amber-400" },
  violet: { bg: "bg-violet-50", text: "text-violet-600", ring: "ring-2 ring-violet-400" },
  indigo: { bg: "bg-indigo-50", text: "text-indigo-600", ring: "ring-2 ring-indigo-400" },
  yellow: { bg: "bg-yellow-50", text: "text-yellow-600", ring: "ring-2 ring-yellow-400" },
  gray:   { bg: "bg-gray-50",   text: "text-gray-400",   ring: "ring-2 ring-gray-300" },
};

export function KpiCard({ label, value, sub, icon: Icon, tone = "blue", href, onClick, selected, title, valueClassName }: {
  label: string;
  value: ReactNode;
  sub?: string;
  icon?: ElementType;
  tone?: KpiTone;
  href?: string;
  onClick?: () => void;
  selected?: boolean;
  title?: string;
  valueClassName?: string;
}) {
  const t = TONE[tone];
  const body = (
    <>
      {Icon && (
        <span className={cn("inline-flex self-start rounded-lg p-2", t.bg)}>
          <Icon className={cn("h-5 w-5", t.text)} />
        </span>
      )}
      <span className={cn("block text-2xl font-bold leading-none text-gray-900", valueClassName)}>{value}</span>
      <span className="block min-w-0">
        <span className="block break-words text-sm font-medium leading-snug text-gray-700">{label}</span>
        {sub && <span className="mt-0.5 block break-words text-xs text-gray-400">{sub}</span>}
      </span>
    </>
  );
  const box = "card flex h-full w-full flex-col items-start gap-2 p-4 text-left";
  if (href) {
    return (
      <Link href={href} title={title} className={cn(box, "transition-shadow hover:shadow-md")}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} aria-pressed={!!selected}
        className={cn(box, "transition-shadow hover:shadow-md", selected && t.ring)}>
        {body}
      </button>
    );
  }
  return <div title={title} className={box}>{body}</div>;
}
