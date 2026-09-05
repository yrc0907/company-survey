import { json } from "@/lib/api/http";
import { getResearchRepositoryHealth } from "@/lib/providers/repository-factory";
import { getAiConfigurationStatus } from "@/lib/services/ai-configuration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 轻量健康检查；配置了 PostgreSQL 时会执行 SELECT 1，而不是仅检查环境变量。 */
export async function GET() {
  const database = await getResearchRepositoryHealth();
  const revision = process.env.APP_REVISION?.trim();
  return json({ ok: database.ok, persistence: database.persistence, ai: getAiConfigurationStatus(), revision: revision && /^[0-9a-f]{7,64}$/i.test(revision) ? revision : "unknown" }, { status: database.ok ? 200 : 503 });
}
