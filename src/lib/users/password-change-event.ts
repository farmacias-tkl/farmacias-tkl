// =============================================================================
// SecurityEvent de un usuario que cambia su propia contraseña. La fecha es
// createdAt del evento. Nunca lleva la contraseña ni su hash.
// =============================================================================

import type { Prisma } from "@prisma/client";

export function passwordChangedEvent(
  user: { id: string; email: string },
  headers: Headers,
): Prisma.SecurityEventUncheckedCreateInput {
  return {
    userId:    user.id,
    actorId:   user.id,
    type:      "USER_PASSWORD_CHANGED",
    detail:    { email: user.email },
    ip:        headers.get("x-forwarded-for") ?? headers.get("x-real-ip"),
    userAgent: headers.get("user-agent"),
  };
}
