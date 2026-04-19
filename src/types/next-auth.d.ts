import type { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id:                 string;
      name:               string;
      email:              string;
      role:               UserRole;
      branchId:           string | null;
      mustChangePassword: boolean;
    };
  }
  interface User {
    id:                 string;
    name:               string;
    email:              string;
    role:               UserRole;
    branchId:           string | null;
    mustChangePassword: boolean;
  }
}
