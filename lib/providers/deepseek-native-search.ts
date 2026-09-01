import { getModelProviderConfig } from "@/lib/services/ai-configuration";

/** DeepSeek 原生联网搜索的准备结果；V1 只构造受控请求，不在配置检查或测试时发起网络调用。 */
export interface DeepSeekResponsesSearchRequest {
  endpoint: URL;
  headers: Record<string, string>;
  body: { model: string; input: string; tools: Array<{ type: "web_search" }> };
}

/**
 * 准备 DeepSeek Responses web search 请求。
 * 仅接受用户的研究问题，不能把附件、来源原文或任意 URL 交给搜索工具；实际执行留给未来显式搜索 Job。
 */
export function prepareDeepSeekResponsesSearch(question: string): DeepSeekResponsesSearchRequest | null {
  const enabled = process.env.DEEPSEEK_NATIVE_WEB_SEARCH_ENABLED?.trim().toLowerCase() === "true";
  const config = getModelProviderConfig();
  if (!enabled || config.provider !== "deepseek" || !config.apiBaseUrl || !config.apiKey || !config.model) return null;
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion || normalizedQuestion.length > 1_000) return null;
  const base = new URL(config.apiBaseUrl);
  const normalizedPath = base.pathname.replace(/\/+$/, "");
  const apiPath = normalizedPath.endsWith("/v1") ? normalizedPath : `${normalizedPath}/v1`;

  return {
    endpoint: new URL(`${apiPath}/responses`, base.origin),
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: { model: config.model, input: normalizedQuestion, tools: [{ type: "web_search" }] },
  };
}
