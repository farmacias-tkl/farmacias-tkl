"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg" | "xl";

const SIZE_CLASSES: Record<Size, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
};

interface Props {
  open:           boolean;
  onClose:        () => void;
  title?:         string;
  size?:          Size;
  /** Si false, no cierra al hacer click fuera. Default true. */
  dismissOnBackdrop?: boolean;
  /** Si false, oculta el botón X. Default true. */
  showCloseButton?: boolean;
  /** Z-index del overlay. Default 50. Subir para modal sobre modal (no usado en este sprint). */
  zIndex?:        number;
  children:       React.ReactNode;
}

/**
 * Modal base: overlay fijo, ESC cierra, click fuera cierra (configurable),
 * scroll-lock del body mientras está abierto. Sin portal — vive donde se
 * monte (el overlay full-screen lo posiciona igual).
 */
export function Modal({
  open,
  onClose,
  title,
  size = "md",
  dismissOnBackdrop = true,
  showCloseButton   = true,
  zIndex            = 50,
  children,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null);

  // ESC para cerrar + scroll lock
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const onBackdropClick = (e: React.MouseEvent) => {
    if (!dismissOnBackdrop) return;
    if (contentRef.current && !contentRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      style={{ zIndex }}
      onMouseDown={onBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "modal-title" : undefined}
    >
      <div
        ref={contentRef}
        className={cn(
          "card w-full bg-white relative my-0 sm:my-4 rounded-t-2xl sm:rounded-2xl max-h-[95vh] flex flex-col",
          SIZE_CLASSES[size],
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {(title || showCloseButton) && (
          <div className="flex items-start justify-between gap-3 px-4 sm:px-5 pt-4 pb-3 border-b border-gray-100 shrink-0">
            {title && (
              <h3 id="modal-title" className="text-sm font-semibold text-gray-900 leading-tight pt-0.5">
                {title}
              </h3>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-700 transition-colors shrink-0 -mr-1 -mt-1 p-1"
                aria-label="Cerrar"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
        <div className="overflow-y-auto px-4 sm:px-5 py-4 flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}
