import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@prisma/client";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 24 * 60 * 60 }, // 60 días global; middleware expira no-OWNER a 8h via iat
  secret: process.env.AUTH_SECRET,
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Credentials({
      credentials: {
        email:    { label: "Email",      type: "email" },
        password: { label: "Contrasena", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          select: { id: true, name: true, email: true, role: true, branchId: true, mustChangePassword: true, active: true, passwordHash: true },
        });
        if (!user || !user.active) return null;
        const ok = await bcrypt.compare(credentials.password as string, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, name: user.name, email: user.email, role: user.role, branchId: user.branchId, mustChangePassword: user.mustChangePassword };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id                 = user.id;
        token.role               = (user as any).role;
        token.branchId           = (user as any).branchId;
        token.mustChangePassword = (user as any).mustChangePassword;
        token.iat                = Math.floor(Date.now() / 1000);
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id                 = token.id as string;
        session.user.role               = token.role as UserRole;
        session.user.branchId           = token.branchId as string | null;
        session.user.mustChangePassword = token.mustChangePassword as boolean;
        (session as any).iat            = token.iat;
      }
      return session;
    },
  },
});
