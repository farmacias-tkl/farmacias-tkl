"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, ExternalLink, CheckCircle2, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const OVERTIME_REASONS: Record<string, string> = {
  ABSENCE_COVERAGE:  "Cobertura de ausencia",
  VACATION_COVERAGE: "Cobertura de vacaciones",
  UNDERSTAFFING:     "Falta de personal",
  HIGH_DEMAND:       "Alta demanda",
  OTHER:             "Otro",
};

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  REPORTED: { label: "Reportada", color: "bg-yellow-50 text-yellow-800 border-yellow-200", icon: Clock },
  APPROVED: { label: "Aprobada",  color: "bg-green-50 text-green-800 border-green-200",   icon: CheckCircle2 },
  REJECTED: { label: "Rechazada", color: "bg-red-50 text-red-800 border-red-200",         icon: XCircle },
};

export default function HorasExtrasTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["overtime-tab", employeeId],
    queryFn:  () => fetch(`/api/overtime?employeeId=${employeeId}&limit=50`).then(r => r.json()),
  });

  const records    = data?.data       ?? [];
  const total      = data?.meta?.total ?? 0;
  const totalHours = records.reduce((sum: number, r: any) => sum + Number(r.hours), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">
            Horas extras
            {total > 0 && <span className="ml-1.5 font-normal text-gray-400">({total} registros)</span>}
          </h3>
          {totalHours > 0 && (
            <p className="text-xs text-gray-500 mt-0.5">
              {totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)} hs en total
            </p>
          )}
        </div>
        <Link href="/horas-extras" className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1.5">
          <ExternalLink className="w-3.5 h-3.5" />Registrar horas extras
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i =>
          <div key={i} className="card p-4 h-16 animate-pulse bg-gray-50" />
        )}</div>
      ) : records.length === 0 ? (
        <div className="card p-10 text-center">
          <Clock className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Sin horas extras registradas.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((r: any) => (
            <OvertimeCard key={r.id} record={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function OvertimeCard({ record: r }: { record: any }) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[r.status] ?? STATUS_META.REPORTED;
  const SI   = meta.icon;
  const date = new Date(r.date).toLocaleDateString("es-AR", {
    day: "numeric", month: "short", year: "numeric",
  });

  const hasDetail = r.notes || r.rejectionReason;

  return (
    <div className="card overflow-hidden">
      <div
        className={cn("px-4 py-3 flex items-start gap-3", hasDetail && "cursor-pointer")}
        onClick={() => hasDetail && setExpanded(v => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-base font-bold text-gray-800">{r.hours}hs</span>
            <span className="text-sm text-gray-600">{date}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 flex-wrap">
            <span>{OVERTIME_REASONS[r.reason] ?? r.reason}</span>
            {r.branch?.name && <><span>·</span><span>{r.branch.name}</span></>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border", meta.color)}>
            <SI className="w-3 h-3" />{meta.label}
          </span>
          {hasDetail && (
            expanded
              ? <ChevronUp className="w-4 h-4 text-gray-400" />
              : <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </div>

      {expanded && hasDetail && (
        <div className="px-4 pb-3 border-t border-gray-100 pt-3 bg-gray-50/50">
          {r.notes && <p className="text-xs text-gray-600 italic">{r.notes}</p>}
          {r.rejectionReason && (
            <p className="text-xs text-red-600 mt-1">Motivo de rechazo: {r.rejectionReason}</p>
          )}
        </div>
      )}
    </div>
  );
}
