"use client";
import { useRef, useState, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { Loader2 } from "lucide-react";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  onClick: (e: MouseEvent<HTMLButtonElement>) => Promise<unknown> | unknown;
};

/**
 * Botón para una acción contra el servidor: mientras corre muestra el indicador,
 * queda deshabilitado e ignora un segundo click (el ref frena el doble toque
 * antes de que React vuelva a dibujar).
 */
export function AsyncButton({ onClick, disabled, children, type = "button", ...rest }: Props) {
  const running = useRef(false);
  const [pending, setPending] = useState(false);

  const handle = async (e: MouseEvent<HTMLButtonElement>) => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      await onClick(e);
    } finally {
      running.current = false;
      setPending(false);
    }
  };

  return (
    <button {...rest} type={type} onClick={handle} disabled={disabled || pending} aria-busy={pending}>
      {pending && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden />}
      {children}
    </button>
  );
}
