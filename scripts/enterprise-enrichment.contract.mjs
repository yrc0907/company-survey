import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** 资料富化静态契约：不连接生产数据库，不读取凭据，只检查来源、哈希、版本和失败边界。 */
const script = await readFile(resolve(process.cwd(), "scripts", "enrich-enterprise-reports.mjs"), "utf8");
const required = ["source", "source_chunk", "knowledge_commit", "document_revision", "commit_change", "content_hash", "needs_verification", "AbortController", "ON CONFLICT (id) DO NOTHING"];
const failures = required.filter((token) => !script.includes(token));
if (!script.includes("const companies = [") || (script.match(/\[\"project-/g) ?? []).length !== 5) failures.push("五家冻结企业官网清单");
if (/sk-[A-Za-z0-9]/.test(script)) failures.push("脚本不得包含 API Key");
if (failures.length) { console.error(JSON.stringify({ status: "failed", failures }, null, 2)); process.exitCode = 1; }
else console.log(JSON.stringify({ status: "passed", companyCount: script.match(/\[\"project-/g)?.length ?? 0 }));
