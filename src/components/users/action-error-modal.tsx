"use client";
import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

interface Props {
  /** "" = cerrado. */
  message: string;
  onClose: () => void;
  title?:  string;
}

/**
 * Error de una acción sobre usuarios, en overlay fijo: visible sin importar
 * el scroll del <main>. zIndex 60 para quedar sobre ConfirmModal (z-50).
 */
export function ActionErrorModal({ message, onClose, title = "No se pudo completar la acción" }: Props) {
  return (
    <Modal open={!!message} onClose={onClose} title={title} size="sm" zIndex={60}>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-700">{message}</p>
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">
            Entendido
          </button>
        </div>
      </div>
    </Modal>
  );
}
