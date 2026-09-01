import type { DefaultSession } from "next-auth";

import type { PlatformRole } from "@/lib/domain/platform";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      role: PlatformRole;
    } & DefaultSession["user"];
  }

  interface User {
    username: string;
    role: PlatformRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    username?: string;
    platformRole?: PlatformRole;
  }
}

export {};
