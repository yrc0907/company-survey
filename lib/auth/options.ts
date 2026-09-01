import type { AuthOptions, Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import { z } from "zod";

import type { OAuthIdentityInput, PlatformAccount } from "@/lib/domain/platform";
import { argon2idPasswordHasher } from "@/lib/auth/password";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import { AccountService } from "@/lib/services/platform/account-service";

const credentialsSchema = z.object({
  identifier: z.string().trim().min(3).max(320),
  password: z.string().min(10).max(128),
});

function toAuthUser(account: PlatformAccount) {
  return { id: account.id, email: account.email, name: account.displayName, image: null, username: account.username, role: account.role };
}

function accountService(): AccountService {
  return new AccountService(getPlatformRepository(), argon2idPasswordHasher);
}

/** 把可信数据库用户写入加密 JWT；刷新请求没有 user 时保留已有 Claims。 */
export function projectUserToJwt(token: JWT, user?: User): JWT {
  if (!user) return token;
  return { ...token, userId: user.id, username: user.username, platformRole: user.role };
}

/** 只把应用需要的稳定身份字段投影到 Session，缺少任何字段时保持 fail closed。 */
export function projectJwtToSession(session: Session, token: JWT): Session {
  if (!session.user || !token.userId || !token.username || !token.platformRole) return session;
  return { ...session, user: { ...session.user, id: token.userId, username: token.username, role: token.platformRole } };
}

const providers: AuthOptions["providers"] = [
  CredentialsProvider({
    name: "邮箱或用户名",
    credentials: {
      identifier: { label: "邮箱或用户名", type: "text" },
      password: { label: "密码", type: "password" },
    },
    /** Credentials 只验证密码并返回服务端角色；客户端传入的 id/role 一律忽略。 */
    async authorize(rawCredentials) {
      const parsed = credentialsSchema.safeParse(rawCredentials);
      if (!parsed.success) return null;
      try {
        return toAuthUser(await accountService().authenticate(parsed.data.identifier, parsed.data.password));
      } catch {
        return null;
      }
    },
  }),
];

const githubClientId = process.env.GITHUB_CLIENT_ID?.trim();
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
if (githubClientId && githubClientSecret) {
  providers.push(GitHubProvider({ clientId: githubClientId, clientSecret: githubClientSecret }));
}

/**
 * Auth.js v4 配置边界。使用加密 JWT Session，把稳定 user id/role 投影给应用；
 * OAuth 登录在 signIn 回调中写入平台身份，未配置 GitHub 环境变量时不暴露失效入口。
 */
export const authOptions: AuthOptions = {
  providers,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 14 },
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || account.provider === "credentials") return true;
      if (account.provider !== "github" || !user.email) return false;
      const githubProfile = profile as { login?: string } | undefined;
      const identity: OAuthIdentityInput = {
        provider: "github", providerAccountId: account.providerAccountId, email: user.email,
        usernameHint: githubProfile?.login ?? user.email.split("@")[0]!, displayName: user.name, avatarUrl: user.image,
      };
      const platformAccount = await accountService().authenticateOAuth(identity);
      user.id = platformAccount.id;
      user.username = platformAccount.username;
      user.role = platformAccount.role;
      return true;
    },
    async jwt({ token, user }) {
      return projectUserToJwt(token, user);
    },
    async session({ session, token }) {
      return projectJwtToSession(session, token);
    },
  },
};
