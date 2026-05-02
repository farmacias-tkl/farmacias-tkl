"use client";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "danger" | "warning";

interface Props {
  open:          boolean;
  title:         string;
  message:       string;
  variant?:      Variant;
  confirmLabel?: string;
  cancelLabel?:  string;
  loading?:      boolean;
  onConfirm:     () => void;
  onCancel:      () => void;
}

const VARIANTS: Record<Variant, { border: string; iconBg: string; iconColor: string; icon: any; btn: string }> = {
  danger: {
    border:    "border-red-300",
    iconBg:    "bg-red-100",
    iconColor: "text-red-600",
    icon:      ShieldAlert,
    btn:       "bg-red-600 hover:bg-red-700 text-white",
  },
  warning: {
    border:    "border-orange-300",
    iconBg:    "bg-orange-100",
    iconColor: "text-orange-600",
    icon:      AlertTriangle,
    btn:       "bg-orange-600 hover:bg-orange-700 text-white",
  },
};

export function ConfirmModal({
  open, title, message, variant = "warning",
  confirmLabel = "Confirmar", cancelLabel = "Cancelar",
  loading = false, onConfirm, onCancel,
}: Props) {
  if (!open) return null;
  const v = VARIANTS[variant];
  const Icon = v.icon;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
      <div className={cn("card p-5 w-full max-w-md border-2", v.border)}>
        <div className="flex items-start gap-3 mb-3">
          <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0", v.iconBg)}>
            <Icon className={cn("w-5 h-5", v.iconColor)} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
            <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-4">
          <button
            onClick={onCancel}
            disabled={loading}
            className="btn-secondary"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn("px-3 py-1.5 rounded-md text-sm font-medium transition-colors", v.btn, loading && "opacity-50")}
          >
            {loading ? "Procesando..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
