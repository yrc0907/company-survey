import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** 独立判断脚本静态契约：不连接生产库，只检查 13 家公司和事实/推断边界。 */
const script = await readFile(resolve(process.cwd(), "scripts", "refresh-analyst-theses.mjs"), "utf8");
const required = ["研究者分析与战略判断", "财报", "股价", "最高收益产品", "竞争", "政策", "合作", "inference", "needs_verification", "knowledge_commit", "document_revision"];
const failures = required.filter((token) => !script.includes(token));
if ((script.match(/^  \"[^\"]+\":/gm) ?? []).length < 13) failures.push("13 家企业独立判断");
if (failures.length) { console.error(JSON.stringify({ status: "failed", failures }, null, 2)); process.exitCode = 1; }
else console.log(JSON.stringify({ status: "passed", companyCount: script.match(/^  \"[^\"]+\":/gm)?.length ?? 0 }));
