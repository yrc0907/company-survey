import { resolveMx, resolveTxt } from "node:dns/promises";

/**
 * 认证与邮件 DNS 只读预检。
 * 不读取文件、不打印密钥、不发送短信/邮件；仅报告环境变量是否存在和 DNS 记录是否可见。
 */
const env = process.env;
const domain = (env.AUTH_EMAIL_DOMAIN || env.DOMAIN || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
const required = ["NEXTAUTH_SECRET", "EMAIL_PROVIDER", "SMS_PROVIDER", "CAPTCHA_PROVIDER"];
const checks = required.map((name) => ({ name, configured: Boolean(env[name]?.trim()) }));
const result = { domain: domain || null, environment: checks, dns: { mx: "not_checked", spf: "not_checked", dkim: "not_checked", dmarc: "not_checked" }, warnings: [] };

if (!domain) result.warnings.push("未配置 AUTH_EMAIL_DOMAIN 或 DOMAIN，无法检查邮件 DNS");
if (domain) {
  try {
    const records = await resolveMx(domain);
    result.dns.mx = records.length > 0 ? "present" : "missing";
  } catch { result.dns.mx = "missing"; }
  try {
    const txt = (await resolveTxt(domain)).flat().map((value) => value.toLowerCase());
    result.dns.spf = txt.some((value) => value.startsWith("v=spf1")) ? "present" : "missing";
  } catch { result.dns.spf = "missing"; }
  const selector = env.DKIM_SELECTOR?.trim();
  if (!selector) {
    result.dns.dkim = "needs_selector";
    result.warnings.push("未配置 DKIM_SELECTOR，无法确定 DKIM 主机名");
  } else {
    try {
      const txt = (await resolveTxt(`${selector}._domainkey.${domain}`)).flat().map((value) => value.toLowerCase());
      result.dns.dkim = txt.some((value) => value.includes("v=dkim1")) ? "present" : "missing";
    } catch { result.dns.dkim = "missing"; }
  }
  try {
    const txt = (await resolveTxt(`_dmarc.${domain}`)).flat().map((value) => value.toLowerCase());
    result.dns.dmarc = txt.some((value) => value.startsWith("v=dmarc1")) ? "present" : "missing";
  } catch { result.dns.dmarc = "missing"; }
}

for (const item of checks) if (!item.configured) result.warnings.push(`${item.name} 未配置`);
const ready = result.warnings.length === 0 && Object.values(result.dns).every((value) => value === "present");
console.log(JSON.stringify({ status: ready ? "ready_for_provider_test" : "needs_configuration", ...result }, null, 2));
