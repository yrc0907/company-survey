import postgres from "postgres";

export interface PublicMarketPoint { date: string; open: number; close: number; high: number; low: number; volume: number | null; amount: number | null; }

/** 公开行情只读服务；先验证项目 public/published，再按 project_id 查询已落库日线。 */
export class PublicMarketService {
  public async list(projectIdOrSlug: string, limit = 260): Promise<{ projectId: string; points: PublicMarketPoint[]; source: "postgres" }> {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) return { projectId: projectIdOrSlug, points: [], source: "postgres" };
    const sql = postgres(databaseUrl, { max: 1, idle_timeout: 10, connect_timeout: 5 });
    try {
      const projects = await sql<{ id: string }[]>`SELECT id FROM knowledge_project WHERE (id=${projectIdOrSlug} OR slug=${projectIdOrSlug}) AND visibility='public' AND status='published' LIMIT 1`;
      if (!projects[0]) return { projectId: projectIdOrSlug, points: [], source: "postgres" };
      const bounded = Math.min(520, Math.max(1, Math.trunc(limit)));
      const rows = await sql<{ trade_date: string; open: string; close: string; high: string; low: string; volume: string | null; amount: string | null }[]>`SELECT trade_date::text, open::text, close::text, high::text, low::text, volume::text, amount::text FROM market_price_daily WHERE project_id=${projects[0].id} ORDER BY trade_date ASC LIMIT ${bounded}`;
      return { projectId: projects[0].id, points: rows.map((row) => ({ date: row.trade_date, open: Number(row.open), close: Number(row.close), high: Number(row.high), low: Number(row.low), volume: row.volume == null ? null : Number(row.volume), amount: row.amount == null ? null : Number(row.amount) })).filter((row) => [row.open, row.close, row.high, row.low].every(Number.isFinite)), source: "postgres" };
    } finally { await sql.end({ timeout: 5 }); }
  }
}
