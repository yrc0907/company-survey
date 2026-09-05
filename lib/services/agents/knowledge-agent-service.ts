import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import type { ContextProjection, ContextProjectionInput } from "@/lib/services/context-projection-service";
import type { KnowledgeWorkflowType } from "@/lib/domain/agents";
import type { ResearchRepository } from "@/lib/providers/research-repository";
import { getModelProvider, type ModelCompletion, type ModelProvider } from "@/lib/providers/model-provider";
import { ContextProjectionService } from "@/lib/services/context-projection-service";

/** 平台级子 Agent；调研只是其中一种任务，不是助手的唯一能力。 */
export type KnowledgeAgentName = "research" | "document" | "evidence" | "writing" | "review" | "conflict" | "publishing" | "memory";
export type KnowledgeToolName = "search_sources" | "read_source" | "query_graph" | "extract_claims" | "validate_citations" | "propose_patch" | "propose_merge_request" | "propose_memory";

export interface KnowledgeAgentAuthorization {
  actorUserId: string;
  projectId: string;
  scope: "current_file" | "current_project";
}

export interface KnowledgeAgentFinding {
  agent: KnowledgeAgentName;
  status: "completed" | "degraded";
  summary: string;
  data: Record<string, unknown>;
  tools: KnowledgeToolName[];
  durationMs?: number;
}

type KnowledgeAgentRunner = (context: ContextProjection) => Promise<KnowledgeAgentFinding>;

interface KnowledgeAgentDefinition {
  name: KnowledgeAgentName;
  description: string;
  tools: KnowledgeToolName[];
  run: KnowledgeAgentRunner;
}

export interface KnowledgeAgentResult {
  context: ContextProjection;
  answer: string | null;
  completion: ModelCompletion;
  workflow: {
    type: "knowledge_assistant";
    workflowType: KnowledgeWorkflowType;
    selectedAgents: KnowledgeAgentName[];
    findings: KnowledgeAgentFinding[];
    currentNode: "completed" | "degraded";
    budget: { maxAgents: number; maxSteps: number; timeoutMs: number };
  };
}

interface KnowledgeAgentInput extends ContextProjectionInput {}

interface KnowledgeAgentState {
  input: KnowledgeAgentInput;
  selectedAgents: KnowledgeAgentName[];
  context: ContextProjection | null;
  findings: KnowledgeAgentFinding[];
  completion: ModelCompletion | null;
}

/** Agent Registry 是新增子 Agent 的唯一入口，编排器不直接依赖各 Agent 的实现细节。 */
const agentRegistry: Record<KnowledgeAgentName, KnowledgeAgentDefinition> = {
  research: {
    name: "research",
    description: "在当前 Scope 内召回证据和关系路径。",
    tools: ["search_sources", "read_source", "query_graph"],
    run: async (context) => ({
      agent: "research",
      status: context.evidence.length || context.selectedContext ? "completed" : "degraded",
      summary: context.evidence.length ? `Research Agent 找到 ${context.evidence.length} 个受限证据片段。` : "Research Agent 未找到可用证据。",
      data: { evidenceIds: context.evidence.map((item) => item.chunkId), graphPathCount: context.graphPaths.length, mode: context.mode }, tools: ["search_sources", "read_source", "query_graph"],
    }),
  },
  document: {
    name: "document", description: "把受控输入整理成可索引的文档处理建议，原件保持不可变。", tools: ["read_source"],
    run: async (context) => ({ agent: "document", status: "completed", summary: "Document Agent 已生成文档清洗与分块建议。", data: { mode: context.mode, originalImmutable: true, indexing: "requires_human_confirmation" }, tools: ["read_source"] }),
  },
  evidence: {
    name: "evidence", description: "从受限来源提取 Claim、引用和事实状态。", tools: ["extract_claims", "validate_citations"],
    run: async (context) => ({
      agent: "evidence", status: context.evidence.length ? "completed" : "degraded", summary: context.evidence.length ? `Evidence Agent 已提取 ${context.evidence.length} 条候选证据。` : "Evidence Agent 没有可提取的来源。",
      data: { claims: context.evidence.slice(0, 12).map((item) => ({ claim: item.quote.slice(0, 240), state: "fact", sourceId: item.sourceId, chunkId: item.chunkId, contentHashRequired: true })), missingEvidence: context.evidence.length === 0 }, tools: ["extract_claims", "validate_citations"],
    }),
  },
  writing: {
    name: "writing",
    description: "基于已投影证据准备回答、改写或草稿。",
    tools: ["propose_patch"],
    run: async (context) => ({
      agent: "writing",
      status: context.refusalReason ? "degraded" : "completed",
      summary: context.refusalReason ? "Writing Agent 因证据不足保留待核验状态。" : "Writing Agent 已准备基于受限证据生成内容。",
      data: { canDraft: !context.refusalReason, requiresPatchApproval: true }, tools: ["propose_patch"],
    }),
  },
  review: {
    name: "review",
    description: "检查引用完整性和证据边界。",
    tools: ["validate_citations"],
    run: async (context) => {
      const citationReady = context.evidence.length > 0 && context.evidence.every((item) => Boolean(item.chunkId && item.sourceId));
      return {
        agent: "review",
        status: citationReady ? "completed" : "degraded",
        summary: citationReady ? "Review Agent 通过基础引用完整性检查。" : "Review Agent 发现引用信息不完整。",
        data: { citationReady, evidenceCount: context.evidence.length, refusalReason: context.refusalReason }, tools: ["validate_citations"],
      };
    },
  },
  conflict: {
    name: "conflict", description: "识别来源和关系路径中的冲突，要求人工核验。", tools: ["read_source", "validate_citations"],
    run: async (context) => ({ agent: "conflict", status: "completed", summary: context.graphPaths.length > 1 ? "Conflict Agent 已标出需要人工核验的关系路径。" : "Conflict Agent 未发现可比较的关系路径。", data: { candidateConflictCount: Math.max(0, context.graphPaths.length - 1), requiresHumanReview: context.graphPaths.length > 1 }, tools: ["read_source", "validate_citations"] }),
  },
  publishing: {
    name: "publishing", description: "生成 Patch/MR/发布说明和归因建议，但不自动写入或合并。", tools: ["propose_patch", "propose_merge_request"],
    run: async (context) => ({ agent: "publishing", status: context.refusalReason ? "degraded" : "completed", summary: context.refusalReason ? "Publishing Agent 因证据不足未生成发布建议。" : "Publishing Agent 已生成待人工确认的发布建议。", data: { changeSummary: context.task.slice(0, 240), mergeRequest: "requires_branch_and_human_confirmation", releaseNote: true, attribution: "suggestion_only", autoMerge: false }, tools: ["propose_patch", "propose_merge_request"] }),
  },
  memory: {
    name: "memory",
    description: "提出记忆处理建议，不自动保存长期记忆。",
    tools: ["propose_memory"],
    run: async (context) => ({
      agent: "memory",
      status: "completed",
      summary: "Memory Agent 仅提出记忆处理建议，不会自动保存长期记忆。",
      data: { persistence: "user_confirmation_required", projectId: context.report.id }, tools: ["propose_memory"],
    }),
  },
};

/** 返回当前已注册的 Agent，供任务路由和后续管理界面使用。 */
export function listKnowledgeAgents(): Array<Pick<KnowledgeAgentDefinition, "name" | "description">> {
  return Object.values(agentRegistry).map(({ name, description }) => ({ name, description }));
}

export function classifyKnowledgeWorkflow(question: string): KnowledgeWorkflowType {
  const normalized = question.trim().toLocaleLowerCase("zh-CN");
  if (/(上传|文件|文档|解析|chunk|入库|索引)/i.test(normalized)) return "ingestion";
  if (/(发布|release|mr|合并申请|周报|提交修改)/i.test(normalized)) return "publishing";
  if (/(记忆|偏好|长期保存|memory)/i.test(normalized)) return "memory";
  if (/(改写|重写|润色|编辑|patch|draft)/i.test(normalized)) return "editing";
  if (/(审查|审核|冲突|核验|核查|风险|review|verify)/i.test(normalized)) return "review";
  return "research";
}

const KnowledgeState = Annotation.Root({
  input: Annotation<KnowledgeAgentInput>(),
  selectedAgents: Annotation<KnowledgeAgentName[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  context: Annotation<ContextProjection | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  findings: Annotation<KnowledgeAgentFinding[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
  completion: Annotation<ModelCompletion | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
});

type KnowledgeStateValue = typeof KnowledgeState.State;

/** 根据用户意图做有限动态路由；research 是证据型回答的基础，其他 Agent 按需加入。 */
export function routeKnowledgeAgents(question: string): KnowledgeAgentName[] {
  const normalized = question.trim().toLocaleLowerCase("zh-CN");
  const selected = new Set<KnowledgeAgentName>(["research"]);
  if (/(改写|重写|润色|编辑|总结|整理成|写一份|生成报告|draft|rewrite|summarize)/i.test(normalized)) selected.add("writing");
  if (/(引用|证据|冲突|核验|核查|检查|风险|矛盾|来源|citation|review|verify)/i.test(normalized)) selected.add("review");
  if (/(记忆|记得|偏好|之前的决定|长期保存|todo|memory)/i.test(normalized)) selected.add("memory");
  if (/(上传|文件|文档|解析|chunk|入库|索引)/i.test(normalized)) selected.add("document");
  if (/(事实|claim|证据台账|证据提取|evidence)/i.test(normalized)) selected.add("evidence");
  if (/(冲突|矛盾|不一致|conflict)/i.test(normalized)) selected.add("conflict");
  if (/(发布|release|mr|合并申请|周报|提交修改)/i.test(normalized)) selected.add("publishing");
  const expanded: KnowledgeAgentName[] = ["research", "document", "evidence", "writing", "review", "conflict", "publishing", "memory"];
  return expanded.filter((agent) => selected.has(agent)).slice(0, 5);
}

/**
 * Knowledge Agent 编排服务。
 * 负责把现有 Context Projection、检索和模型 Provider 组合成可追踪的 Agent Workflow；不执行正式知识写入。
 */
export class KnowledgeAgentService {
  private readonly projection: ContextProjectionService;

  public constructor(
    private readonly repository: ResearchRepository,
    private readonly modelProvider: ModelProvider = getModelProvider(),
  ) {
    this.projection = new ContextProjectionService(repository);
  }

  /** 运行一次受限 Multi-Agent 任务，Agent 只产出结构化发现，最终副作用仍由现有领域服务负责。 */
  public async run(input: KnowledgeAgentInput, authorization: KnowledgeAgentAuthorization): Promise<KnowledgeAgentResult> {
    assertAgentScope(input, authorization);
    const graph = new StateGraph(KnowledgeState)
      .addNode("route", (state: KnowledgeStateValue) => ({ selectedAgents: routeKnowledgeAgents(state.input.question) }))
      .addNode("project_context", async (state: KnowledgeStateValue) => ({ context: await this.projection.project(state.input) }))
      .addNode("dispatch_agents", async (state: KnowledgeStateValue) => ({ findings: await this.dispatchAgents(state) }))
      .addNode("synthesize", async (state: KnowledgeStateValue) => ({ completion: await this.synthesize(state) }))
      .addEdge(START, "route")
      .addEdge("route", "project_context")
      .addEdge("project_context", "dispatch_agents")
      .addEdge("dispatch_agents", "synthesize")
      .addEdge("synthesize", END)
      .compile();

    const state = await graph.invoke({ input, selectedAgents: [], context: null, findings: [], completion: null });
    if (!state.context || !state.completion) throw new Error("Agent Workflow 未生成完整结果");
    return {
      context: state.context,
      answer: state.completion.answer,
      completion: state.completion,
      workflow: {
        type: "knowledge_assistant",
        workflowType: classifyKnowledgeWorkflow(input.question),
        selectedAgents: state.selectedAgents,
        findings: state.findings,
        currentNode: state.completion.status === "completed" ? "completed" : "degraded",
        budget: { maxAgents: 5, maxSteps: 8, timeoutMs: 20_000 },
      },
    };
  }

  /** 动态派发独立子 Agent；每个 Agent 只接收最小 Context，不共享完整聊天记录。 */
  private async dispatchAgents(state: KnowledgeAgentState): Promise<KnowledgeAgentFinding[]> {
    if (!state.context) throw new Error("Agent 缺少 Context Projection");
    const tasks = state.selectedAgents.map((agent) => this.runAgent(agent, state.context!));
    return Promise.all(tasks);
  }

  private async runAgent(agent: KnowledgeAgentName, context: ContextProjection): Promise<KnowledgeAgentFinding> {
    const startedAt = Date.now();
    const definition = agentRegistry[agent];
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        definition.run(context),
        new Promise<KnowledgeAgentFinding>((_, reject) => { timeout = setTimeout(() => reject(new Error(`${agent} Agent 超时`)), 20_000); }),
      ]);
      return { ...result, tools: definition.tools, durationMs: Date.now() - startedAt };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /** 只把结构化 Agent 发现投影进最终模型任务，避免 Agent 之间传递无界自然语言。 */
  private async synthesize(state: KnowledgeAgentState): Promise<ModelCompletion> {
    if (!state.context) throw new Error("Agent 缺少 Context Projection");
    const findings = state.findings.map(({ agent, status, summary, data }) => ({ agent, status, summary, data }));
    const task = `${state.context.task}\n\n本轮由以下受控 Agent 协作：${JSON.stringify(findings).slice(0, 6_000)}\n请仅基于 evidence、selectedContext 和 graphPaths 作答；需要修改内容时只提出建议，不直接写入。`;
    return this.modelProvider.complete({ ...state.context, task });
  }
}

function assertAgentScope(input: KnowledgeAgentInput, authorization: KnowledgeAgentAuthorization): void {
  if (!authorization.actorUserId.trim() || !authorization.projectId.trim() || !input.projectId || input.projectId !== authorization.projectId) throw new Error("Agent Scope 无法确认，已拒绝检索");
  if (input.scope !== authorization.scope) throw new Error("Agent Scope 与请求范围不一致，已拒绝检索");
}
