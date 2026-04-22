import { auth } from "@/lib/auth";
import { canAccessRoute } from "@/lib/permissions";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const EXECUTIVE_ROLES = ["OWNER", "ADMIN", "SUPERVISOR"];
const NON_OWNER_MAX_AGE_SEC = 8 * 60 * 60; // 8h

export default auth((req: NextRequest & { auth: any }) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;
  const host = req.headers.get("host") ?? "";
  const isDashboardHost = host.startsWith("dashboard.");

  // Rutas públicas / de auth
  if (pathname.startsWith("/api/auth") || pathname.startsWith("/_next") ||
      pathname === "/login" || pathname === "/cambiar-password" || pathname === "/sin-acceso") {
    if (pathname === "/login" && session?.user) {
      const isOwner = session.user.role === "OWNER";
      return NextResponse.redirect(new URL(
        (isDashboardHost || isOwner) ? "/executive" : "/dashboard",
        req.url,
      ));
    }
    return NextResponse.next();
  }

  if (!session?.user) {
    const url = new URL("/login", req.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  const { role } = session.user;

  // Expiración diferenciada via iat del token: no-OWNER → 8h
  const iat = (session as any).iat as number | undefined;
  if (role !== "OWNER" && typeof iat === "number") {
    const ageSec = Math.floor(Date.now() / 1000) - iat;
    if (ageSec > NON_OWNER_MAX_AGE_SEC) {
      const url = new URL("/login", req.url);
      url.searchParams.set("callbackUrl", pathname);
      url.searchParams.set("expired", "1");
      return NextResponse.redirect(url);
    }
  }

  // Host routing ejecutivo — solo en producción (dashboard.*), localhost queda operativo
  if (isDashboardHost) {
    if (!EXECUTIVE_ROLES.includes(role)) {
      return NextResponse.redirect(new URL("/sin-acceso", req.url));
    }
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/executive", req.url));
    }
    const execAllowed = pathname.startsWith("/executive") ||
                        pathname.startsWith("/api/dashboard") ||
                        pathname.startsWith("/api/sync");
    if (!execAllowed) {
      return NextResponse.redirect(new URL("/executive", req.url));
    }
    const res = NextResponse.next();
    res.headers.set("x-host-type", "executive");
    return res;
  }

  // Host operativo (app.* o localhost) — lógica existente intacta
  if (!canAccessRoute(role, pathname)) {
    const url = new URL("/dashboard", req.url);
    url.searchParams.set("error", "unauthorized");
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|public|favicon.ico).*)"],
};
