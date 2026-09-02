"use client";

import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, CircleAlert, Coins, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

interface FinancialTrendProps { text: string; projectId?: string; }
interface MarketPoint { date: string; close: number; }

interface Metrics {
  latestPrice?: string;
  dayChange?: string;
  periodReturn?: string;
  high?: string;
  low?: string;
  drawdown?: string;
  revenue?: string;
  profit?: string;
  roe?: string;
  reportDate?: string;
}

function match(text: string, pattern: RegExp): string | undefined { return text.match(pattern)?.[1]; }

function parseMetrics(text: string): Metrics {
  return {
    latestPrice: match(text, /最新行情接口返回价：([\d.]+)/),
    dayChange: match(text, /当日涨跌：(-?[\d.]+)/),
    periodReturn: match(text, /收盘区间收益 (-?[\d.]+)%/),
    high: match(text, /最高 ([\d.]+)/),
    low: match(text, /最低 ([\d.]+)/),
    drawdown: match(text, /最大回撤 (-?[\d.]+)%/),
    reportDate: match(text, /最新财报期：([^；。]+)/),
    revenue: match(text, /营业收入：([\d.]+)/),
    profit: match(text, /归母净利润：([\d.]+)/),
    roe: match(text, /加权 ROE：([\d.]+)%/),
  };
}

function formatAmount(value?: string): string { if (!value) return "待核验"; const number = Number(value); return Number.isFinite(number) ? `${(number / 100_000_000).toFixed(2)} 亿` : "待核验"; }

/**
 * 将财报/行情文档中的已落库字段投影为数据卡和区间图。
 * 不使用随机点位或模型生成数字；解析不到字段就保持“待核验”。
 */
export function FinancialTrend({ text, projectId }: FinancialTrendProps) {
  const metrics = parseMetrics(text);
  const [series, setSeries] = useState<MarketPoint[]>([]);
  const [seriesState, setSeriesState] = useState<"idle" | "loading" | "ready" | "error">(projectId ? "loading" : "idle");
  useEffect(() => {
    if (!projectId) { setSeries([]); setSeriesState("idle"); return; }
    let cancelled = false;
    setSeriesState("loading");
    void fetch(`/api/platform/projects/${encodeURIComponent(projectId)}/market?limit=260`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json().catch(() => ({})) as { points?: Array<{ date?: unknown; close?: unknown }> };
      if (!response.ok) throw new Error("market unavailable");
      const points = Array.isArray(payload.points) ? payload.points.flatMap((point) => typeof point.date === "string" && typeof point.close === "number" && Number.isFinite(point.close) ? [{ date: point.date, close: point.close }] : []) : [];
      if (!cancelled) { setSeries(points); setSeriesState("ready"); }
    }).catch(() => { if (!cancelled) setSeriesState("error"); });
    return () => { cancelled = true; };
  }, [projectId]);
  const low = Number(metrics.low); const high = Number(metrics.high); const latest = Number(metrics.latestPrice);
  const rangeReady = Number.isFinite(low) && Number.isFinite(high) && Number.isFinite(latest) && high > low;
  const latestPosition = rangeReady ? Math.min(100, Math.max(0, ((latest - low) / (high - low)) * 100)) : 0;
  const chartPoints = useMemo(() => {
    if (series.length < 2) return "";
    const min = Math.min(...series.map((point) => point.close)); const max = Math.max(...series.map((point) => point.close)); const spread = Math.max(max - min, 0.000001);
    return series.map((point, index) => `${(index / (series.length - 1)) * 100},${100 - ((point.close - min) / spread) * 86 - 7}`).join(" ");
  }, [series]);
  const periodReturnNumber = Number(metrics.periodReturn);
  const positive = Number.isFinite(periodReturnNumber) && periodReturnNumber >= 0;
  return <section className="mx-auto w-full max-w-[860px] px-5 pb-2 sm:px-14" aria-label="财报与行情指标">
    <div className="mb-3 flex items-center justify-between gap-3"><div><p className="m-0 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"><BarChart3 size={14} />已落库指标</p><p className="mb-0 mt-1 text-xs text-muted-foreground">来源：公开行情/财报数据文档；不代表投资建议。</p></div>{metrics.reportDate ? <span className="rounded-full border px-2 py-1 text-[10px] text-muted-foreground">财报期 {metrics.reportDate}</span> : null}</div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Metric label="最新价" value={metrics.latestPrice ?? "待核验"} suffix={metrics.dayChange ? `日变动 ${metrics.dayChange}` : undefined} icon={<Coins size={14} />} />
      <Metric label="区间收益" value={metrics.periodReturn ? `${metrics.periodReturn}%` : "待核验"} tone={positive ? "positive" : "negative"} suffix={metrics.drawdown ? `最大回撤 ${metrics.drawdown}%` : undefined} icon={positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />} />
      <Metric label="营业收入" value={formatAmount(metrics.revenue)} suffix="公开财报字段" icon={<Activity size={14} />} />
      <Metric label="归母净利润" value={formatAmount(metrics.profit)} suffix={metrics.roe ? `加权 ROE ${metrics.roe}%` : "公开财报字段"} icon={<BarChart3 size={14} />} />
    </div>
    {rangeReady ? <div className="mt-3 rounded-lg border bg-muted/15 p-3"><div className="flex items-center justify-between text-[10px] text-muted-foreground"><span>区间最低 {metrics.low}</span><span>区间最高 {metrics.high}</span></div><div className="relative mt-4 h-2 rounded-full bg-muted"><span className="absolute inset-y-0 left-0 rounded-full bg-foreground/15" style={{ width: "100%" }} /><span className="absolute -top-1.5 size-5 -translate-x-1/2 rounded-full border-2 border-background bg-foreground shadow-sm" style={{ left: `${latestPosition}%` }} title={`最新价 ${metrics.latestPrice}`} /></div><div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground"><CircleAlert size={12} />当前价在公开区间中的位置；区间值来自文档记录，不推断未来走势。</div></div> : null}
    {seriesState === "loading" ? <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" />正在读取已落库日线…</div> : null}
    {series.length >= 2 ? <div className="mt-3 rounded-lg border bg-background p-3"><div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground"><span>收盘价历史序列（{series.length} 个交易日）</span><span>{series[0].date} → {series.at(-1)?.date}</span></div><svg viewBox="0 0 100 100" className="h-32 w-full overflow-visible" role="img" aria-label="公开收盘价历史曲线" preserveAspectRatio="none"><polyline points={chartPoints} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg><p className="mb-0 mt-2 flex items-center gap-1 text-[10px] text-muted-foreground"><CircleAlert size={12} />曲线来自公开日线记录，仅描述历史，不预测未来。</p></div> : null}
    {seriesState === "error" ? <p className="mb-0 mt-3 text-xs text-muted-foreground">历史日线暂时不可用；上方汇总指标仍来自已保存的财报文档。</p> : null}
  </section>;
}

function Metric({ label, value, suffix, icon, tone }: { label: string; value: string; suffix?: string; icon: React.ReactNode; tone?: "positive" | "negative" }): JSX.Element {
  const change = tone === "positive" ? <ArrowUpRight size={12} /> : tone === "negative" ? <ArrowDownRight size={12} /> : null;
  return <div className="rounded-lg border bg-muted/20 p-3"><div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">{icon}{label}</div><strong className={`mt-1 block font-mono text-base tabular-nums ${tone === "negative" ? "text-red-700" : tone === "positive" ? "text-foreground" : ""}`}>{value} {change}</strong>{suffix ? <span className="mt-1 block truncate text-[10px] text-muted-foreground">{suffix}</span> : null}</div>;
}
