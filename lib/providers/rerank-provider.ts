/**
 * Reranker Provider 的独立入口。
 * 实现暂与 Embedding 的远程配置共用，便于调用方只依赖精排契约而不接触向量细节。
 */

export {
  DeterministicRerankerProvider,
  getRerankerProvider,
  getRerankerProviderConfig,
  RemoteRerankerProvider,
} from "@/lib/providers/embedding-provider";

export type {
  RerankItem,
  RerankerProvider,
  RerankerProviderConfig,
  RerankResult,
  RemoteRerankerProviderConfig,
} from "@/lib/providers/embedding-provider";
