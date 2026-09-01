import type { ConversationMessage, ConversationSummary, StructuredConversationSummary } from "@/lib/domain/memory";

/** 摘要 Provider 可替换；测试使用确定性实现，生产模型实现也只能返回固定结构。 */
export interface ConversationSummaryProvider {
  readonly name: string;
  readonly model: string;
  summarize(input: { messages: ConversationMessage[]; previous: ConversationSummary | null }): Promise<StructuredConversationSummary>;
}

/**
 * 无网络的保守摘要器。
 * 只抽取用户明确标记的决定、约束和待办，未识别内容保留在 goal，不推断身份或项目事实。
 */
export class DeterministicSummaryProvider implements ConversationSummaryProvider {
  public readonly name = "deterministic";
  public readonly model = "rules-v1";

  public async summarize(input: { messages: ConversationMessage[]; previous: ConversationSummary | null }): Promise<StructuredConversationSummary> {
    const previous = input.previous?.structured;
    const result: StructuredConversationSummary = previous ? structuredClone(previous) : emptyStructuredSummary();
    for (const message of input.messages) {
      if (message.role !== "user" && message.role !== "assistant") continue;
      for (const rawLine of message.content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        if (/^(决定|decision)[:：]/i.test(line)) pushUnique(result.decisions, stripPrefix(line));
        else if (/^(约束|constraint)[:：]/i.test(line)) pushUnique(result.constraints, stripPrefix(line));
        else if (/^(待办|todo)[:：]/i.test(line)) {
          const text = stripPrefix(line);
          if (text && !result.todos.some((todo) => todo.text === text)) result.todos.push({ id: `todo-${message.id}-${result.todos.length + 1}`, text, status: "open" });
        } else if (message.role === "user" && result.goal.length < 8) pushUnique(result.goal, line.slice(0, 500));
      }
    }
    return result;
  }
}

/** 创建完整空结构，确保压缩后关键数组不会因 Provider 省略字段而消失。 */
export function emptyStructuredSummary(): StructuredConversationSummary {
  return { goal: [], decisions: [], constraints: [], entities: [], claims: [], citationIds: [], todos: [], conflicts: [] };
}

function stripPrefix(value: string): string {
  return value.replace(/^[^:：]+[:：]\s*/, "").trim().slice(0, 1_000);
}

function pushUnique(values: string[], value: string): void {
  if (value && !values.includes(value)) values.push(value);
}

