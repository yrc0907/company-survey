import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import type { ContextProjection, ContextProjectionInput } from "@/lib/services/context-projection-service";
import type { ResearchRepository } from "@/lib/providers/research-repository";
import { getModelProvider, type ModelCompletion, type ModelProvider } from "@/lib/providers/model-provider";
import { ContextProjectionService } from "@/lib/services/context-projection-service";

/** 平台级子 Agent；调研只是其中一种任务，不是助手的唯一能力。 */
export type KnowledgeAgentName = "research" | "writing" | "review" | "memory";

export interface KnowledgeAgentFinding {
  agent: KnowledgeAgentName;
  status: "completed" | "degraded";
  summary: string;
  data: Record<string, unknown>;
}

type KnowledgeAgentRunner = (context: ContextProjection) => Promise<KnowledgeAgentFinding>;

interface KnowledgeAgentDefinition {
  name: KnowledgeAgentName;
  description: string;
  run: KnowledgeAgentRunner;
}

export interface KnowledgeAgentResult {
  context: ContextProjection;
  answer: string | null;
  completion: ModelCompletion;
  workflow: {
    type: "knowledge_assistant";
    selectedAgents: KnowledgeAgentName[];
    findings: KnowledgeAgentFinding[];
    currentNode: "completed" | "degraded";
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
    run: async (context) => ({
      agent: "research",
      status: context.evidence.length || context.selectedContext ? "completed" : "degraded",
      summary: context.evidence.length ? `Research Agent 找到 ${context.evidence.length} 个受限证据片段。` : "Research Agent 未找到可用证据。",
      data: { evidenceIds: context.evidence.map((item) => item.chunkId), graphPathCount: context.graphPaths.length, mode: context.mode },
    }),
  },
  writing: {
    name: "writing",
    description: "基于已投影证据准备回答、改写或草稿。",
    run: async (context) => ({
      agent: "writing",
      status: context.refusalReason ? "degraded" : "completed",
      summary: context.refusalReason ? "Writing Agent 因证据不足保留待核验状态。" : "Writing Agent 已准备基于受限证据生成内容。",
      data: { canDraft: !context.refusalReason, requiresPatchApproval: true },
    }),
  },
  review: {
    name: "review",
    description: "检查引用完整性和证据边界。",
    run: async (context) => {
      const citationReady = context.evidence.length > 0 && context.evidence.every((item) => Boolean(item.chunkId && item.sourceId));
      return {
        agent: "review",
        status: citationReady ? "completed" : "degraded",
        summary: citationReady ? "Review Agent 通过基础引用完整性检查。" : "Review Agent 发现引用信息不完整。",
        data: { citationReady, evidenceCount: context.evidence.length, refusalReason: context.refusalReason },
      };
    },
  },
  memory: {
    name: "memory",
    description: "提出记忆处理建议，不自动保存长期记忆。",
    run: async (context) => ({
      agent: "memory",
      status: "completed",
      summary: "Memory Agent 仅提出记忆处理建议，不会自动保存长期记忆。",
      data: { persistence: "user_confirmation_required", projectId: context.report.id },
    }),
  },
};

/** 返回当前已注册的 Agent，供任务路由和后续管理界面使用。 */
export function listKnowledgeAgents(): Array<Pick<KnowledgeAgentDefinition, "name" | "description">> {
  return Object.values(agentRegistry).map(({ name, description }) => ({ name, description }));
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
  const candidates: KnowledgeAgentName[] = ["research", "writing", "review", "memory"];
  return candidates.filter((agent) => selected.has(agent));
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
  public async run(input: KnowledgeAgentInput): Promise<KnowledgeAgentResult> {
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
        selectedAgents: state.selectedAgents,
        findings: state.findings,
        currentNode: state.completion.status === "completed" ? "completed" : "degraded",
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
    return agentRegistry[agent].run(context);
  }

  /** 只把结构化 Agent 发现投影进最终模型任务，避免 Agent 之间传递无界自然语言。 */
  private async synthesize(state: KnowledgeAgentState): Promise<ModelCompletion> {
    if (!state.context) throw new Error("Agent 缺少 Context Projection");
    const findings = state.findings.map(({ agent, status, summary, data }) => ({ agent, status, summary, data }));
    const task = `${state.context.task}\n\n本轮由以下受控 Agent 协作：${JSON.stringify(findings).slice(0, 6_000)}\n请仅基于 evidence、selectedContext 和 graphPaths 作答；需要修改内容时只提出建议，不直接写入。`;
    return this.modelProvider.complete({ ...state.context, task });
  }
}
