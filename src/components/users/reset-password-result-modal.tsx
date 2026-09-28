"use client";
import { useState } from "react";
import { KeyRound, Copy, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

export interface ResetPasswordResult {
  name:     string;
  password: string;
}

interface Props {
  /** null = cerrado. La contraseña vive solo en el estado del padre. */
  result:  ResetPasswordResult | null;
  /** El padre debe limpiar su estado (setResult(null)) al cerrar. */
  onClose: () => void;
}

// Modal no descartable por ESC ni backdrop: el único cierre es el botón explícito.
const noop = () => {};

/**
 * Muestra la contraseña temporal devuelta por reset-password en un modal fijo
 * (visible sin importar el scroll del <main>). Sin persistencia ni logs.
 */
export function ResetPasswordResultModal({ result, onClose }: Props) {
  const [copied,    setCopied]    = useState(false);
  const [copyError, setCopyError] = useState(false);

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.password);
      setCopyError(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  };

  const close = () => {
    setCopied(false);
    setCopyError(false);
    onClose();
  };

  return (
    <Modal
      open={!!result}
      onClose={noop}
      title="Contraseña reseteada"
      size="md"
      dismissOnBackdrop={false}
      showCloseButton={false}
    >
      {result && (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <KeyRound className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-gray-700">
              Contraseña temporal para <span className="font-semibold text-gray-900">{result.name}</span>.
              Es visible <span className="font-semibold">una sola vez</span>: comunicásela al usuario.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <code className="flex-1 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm font-mono font-bold text-amber-900 tracking-wider select-all break-all">
              {result.password}
            </code>
            <button
              type="button"
              onClick={copy}
              className={cn("btn-secondary text-xs py-2 px-3", copied && "text-green-700 border-green-300")}
            >
              {copied
                ? <><CheckCircle2 className="w-4 h-4" />Copiada</>
                : <><Copy className="w-4 h-4" />Copiar</>}
            </button>
          </div>

          {copyError && (
            <p className="text-xs text-red-600">
              No se pudo copiar automáticamente. Seleccioná el texto y copialo manualmente.
            </p>
          )}

          <p className="text-xs text-gray-500">El usuario deberá cambiarla en su próximo ingreso.</p>

          <div className="flex justify-end pt-1">
            <button type="button" onClick={close} className="btn-primary">
              Ya la anoté
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
