import { NextResponse } from "next/server";

/**
 * Error con status HTTP, pensado para lanzarse DENTRO de un `prisma.$transaction`
 * (aborta y revierte la tx) y mapearse a una respuesta en el catch de afuera. Esto
 * permite leer y validar el estado real de la conversación dentro de la transacción
 * (seguridad ante carreras) sin perder códigos HTTP limpios.
 */
export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/** Traduce un error a NextResponse: HttpError → su status; cualquier otro → 500. */
export function errorToResponse(e: unknown): NextResponse {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("[call-center] error inesperado:", e);
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}
