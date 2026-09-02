import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** 行情/财报刷新契约：只检查公开接口、指标计算、来源哈希和版本追加边界。 */
const script = await readFile(resolve(process.cwd(), "scripts", "refresh-market-data.mjs"), "utf8");
const required = ["push2.eastmoney.com", "push2his.eastmoney.com", "RPT_LICO_FN_CPD", "periodReturnPct", "maxDrawdownPct", "TOTAL_OPERATE_INCOME", "PARENT_NETPROFIT", "market_price_daily", "dailyRows", "source_chunk", "document_revision", "needs_verification", "content_hash", "ON CONFLICT (id) DO NOTHING"];
const failures = required.filter((token) => !script.includes(token));
if (failures.length) { console.error(JSON.stringify({ status: "failed", failures }, null, 2)); process.exitCode = 1; }
else console.log(JSON.stringify({ status: "passed", listedCount: script.match(/\[\"project-/g)?.length ?? 0 }));
