import type { AiConfigurationStatus } from "@/lib/domain/research";

/** 可传给兼容模型端的思考强度白名单；未知值应回退为 medium 而不是透传任意字符串。 */
const reasoningEfforts = ["low", "medium", "high"] as const;
type ReasoningEffort = (typeof reasoningEfforts)[number];

/** 解析非敏感的思考强度配置，避免将任意环境变量直接透传给 Provider。 */
export function parseReasoningEffort(value: string | undefined): ReasoningEffort {
  return reasoningEfforts.includes(value as ReasoningEffort) ? (value as ReasoningEffort) : "medium";
}

/** 统一模型 Provider 配置；密钥只在服务端 Provider 内使用，状态对象不包含密钥或 Base URL。 */
export interface ModelProviderConfig {
  provider: "openai_compatible" | "deepseek" | "none";
  apiBaseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
}

/** 读取统一的 MODEL_* 配置，未完整配置时再尝试可选 DeepSeek 变量。 */
export function getModelProviderConfig(): ModelProviderConfig {
  const primaryBaseUrl = process.env.MODEL_API_BASE_URL?.trim();
  const primaryApiKey = process.env.MODEL_API_KEY?.trim();
  const primaryModel = process.env.MODEL_NAME?.trim();
  if (primaryBaseUrl && primaryApiKey && primaryModel) {
    return {
      provider: "openai_compatible", apiBaseUrl: primaryBaseUrl, apiKey: primaryApiKey, model: primaryModel,
      reasoningEffort: parseReasoningEffort(process.env.MODEL_REASONING_EFFORT),
    };
  }

  const deepSeekBaseUrl = process.env.DEEPSEEK_API_BASE_URL?.trim();
  const deepSeekApiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const deepSeekModel = process.env.DEEPSEEK_MODEL?.trim();
  if (deepSeekBaseUrl && deepSeekApiKey && deepSeekModel) {
    return {
      provider: "deepseek", apiBaseUrl: deepSeekBaseUrl, apiKey: deepSeekApiKey, model: deepSeekModel,
      reasoningEffort: parseReasoningEffort(process.env.DEEPSEEK_REASONING_EFFORT),
    };
  }

  return { provider: "none", apiBaseUrl: null, apiKey: null, model: null, reasoningEffort: null };
}

/**
 * 获取模型与联网搜索的可用配置。
 * 本函数绝不发起网络调用，避免“配置检查”产生费用或泄漏用户资料。
 */
export function getAiConfigurationStatus(): AiConfigurationStatus {
  const modelConfig = getModelProviderConfig();
  const deepSeekSearchEnabled = process.env.DEEPSEEK_NATIVE_WEB_SEARCH_ENABLED?.trim().toLowerCase() === "true";
  const domesticSearchConfigured = process.env.SEARCH_DOMESTIC_PROVIDER?.trim() !== "disabled"
    && Boolean(process.env.SEARCH_DOMESTIC_API_BASE_URL?.trim() && process.env.SEARCH_DOMESTIC_API_KEY?.trim());

  return {
    model: modelConfig.provider === "none"
      ? { configured: false, provider: "none", model: null, reasoningEffort: null }
      : { configured: true, provider: modelConfig.provider, model: modelConfig.model, reasoningEffort: modelConfig.reasoningEffort },
    search: deepSeekSearchEnabled && modelConfig.provider === "deepseek"
      ? { configured: true, provider: "deepseek_native", scope: "international" }
      : domesticSearchConfigured
        ? { configured: true, provider: "bocha", scope: "domestic" }
        : { configured: false, provider: "none", scope: "none" },
  };
}
