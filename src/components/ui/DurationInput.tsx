"use client";
import { cn } from "@/lib/utils";

interface Props {
  hours: string;
  minutes: string;
  onChange: (hours: string, minutes: string) => void;
  disabled?: boolean;
  error?: boolean;
  /** id del primer campo, para asociar un <label htmlFor>. */
  id?: string;
}

const digits = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max);

/**
 * Carga de una duración en horas y minutos (dos campos). Los valores se
 * manejan como texto; `joinHM` (lib/time-events/duration) los pasa a minutos.
 */
export function DurationInput({ hours, minutes, onChange, disabled, error, id }: Props) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative w-24">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={hours}
          onChange={(e) => onChange(digits(e.target.value, 3), minutes)}
          className={cn("input pr-7 text-right", error && "input-error")}
          placeholder="0"
          aria-label="Horas"
          disabled={disabled}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">h</span>
      </div>
      <div className="relative w-28">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={minutes}
          onChange={(e) => onChange(hours, digits(e.target.value, 3))}
          className={cn("input pr-10 text-right", error && "input-error")}
          placeholder="0"
          aria-label="Minutos"
          disabled={disabled}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">min</span>
      </div>
    </div>
  );
}
