import { createHash } from "node:crypto";

import { ValidationError } from "@/lib/domain/errors";
import type { ConversationMessage, CriticalFact } from "@/lib/domain/memory";

/**
 * 从原始消息提取压缩时不可丢失的最小事实集合。
 * 这是保守的确定性检查，不把模型输出当作事实来源；未匹配的内容仍保留在原始消息中。
 */
export function extractCriticalFacts(messages: ConversationMessage[]): CriticalFact[] {
  const facts: CriticalFact[] = [];
  const identifiers = new Map<string, Map<string, string[]>>();

  for (const message of messages) {
    if (message.role === "system") continue;
    const sourceMessageIds = [message.id];
    const lines = message.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

    for (const line of lines) {
      for (const match of Array.from(line.matchAll(IDENTIFIER_PATTERN))) {
        const key = normalize(match[1] ?? "id");
        const value = normalizeFactValue(match[2] ?? match[3]);
        if (!value) continue;
        addFact(facts, {
          kind: "identifier", key, value, status: null, sourceMessageIds,
        });
        const values = identifiers.get(key) ?? new Map<string, string[]>();
        const ids = values.get(value) ?? [];
        values.set(value, unique([...ids, ...sourceMessageIds]));
        identifiers.set(key, values);
      }

      for (const match of Array.from(line.matchAll(AMOUNT_PATTERN))) {
        const value = normalizeFactValue(match[0]);
        if (value) addFact(facts, { kind: "amount", key: null, value, status: null, sourceMessageIds });
      }

      for (const match of Array.from(line.matchAll(DATE_PATTERN))) {
        const value = normalizeFactValue(match[0]);
        if (value) addFact(facts, { kind: "date", key: null, value, status: null, sourceMessageIds });
      }

      const todo = parseTodo(line);
      if (todo) {
        addFact(facts, { kind: "todo", key: normalize(todo.text), value: todo.text, status: todo.status, sourceMessageIds });
      }

      const conflict = parseConflict(line);
      if (conflict) {
        addFact(facts, { kind: "conflict", key: null, value: conflict, status: null, sourceMessageIds });
      }
    }
  }

  // 同一标识字段出现多个值时，显式记录冲突，避免摘要把其中一个静默当成最终值。
  identifiers.forEach((values, key) => {
    if (values.size < 2) return;
    const ordered = Array.from(values.entries()).sort(([left], [right]) => left.localeCompare(right));
    const value = `${key}: ${ordered.map(([entry]) => entry).join(" <> ")}`;
    const sourceMessageIds = unique(ordered.flatMap(([, ids]) => ids));
    addFact(facts, { kind: "conflict", key, value, status: null, sourceMessageIds });
  });

  return normalizeFacts(facts);
}

/** 合并旧账本和本次候选；待办以最新状态为准，其余事实只增不删。 */
export function mergeCriticalFacts(previous: CriticalFact[] | undefined, incoming: CriticalFact[]): CriticalFact[] {
  const merged = new Map<string, CriticalFact>();
  for (const fact of [...(previous ?? []), ...incoming]) {
    const identity = factIdentity(fact);
    const prior = merged.get(identity);
    if (!prior) {
      merged.set(identity, cloneFact(fact));
      continue;
    }
    merged.set(identity, {
      ...prior,
      // 新消息在时间上位于旧消息之后，允许用户完成或阻塞同一条待办。
      value: fact.kind === "todo" ? fact.value : prior.value,
      status: fact.kind === "todo" ? fact.status : prior.status,
      sourceMessageIds: unique([...prior.sourceMessageIds, ...fact.sourceMessageIds]),
    });
  }
  return normalizeFacts(Array.from(merged.values()));
}

/** 规范化账本后计算哈希，用于持久化摘要的完整性校验。 */
export function criticalFactsHash(facts: CriticalFact[]): string {
  const canonical = normalizeFacts(facts).map((fact) => ({
    id: fact.id,
    kind: fact.kind,
    key: fact.key,
    value: fact.value,
    status: fact.status,
    sourceMessageIds: [...fact.sourceMessageIds].sort(),
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * 检查摘要是否保留了预期事实、最新待办状态和所有来源消息。
 * 缺失时抛出可分类的 ValidationError；调用方必须保留原始历史并将检查点置为 failed。
 */
export function assertCriticalFactsPreserved(expected: CriticalFact[], actual: CriticalFact[] | undefined): void {
  const actualFacts = actual ?? [];
  const missing: string[] = [];
  for (const fact of expected) {
    const candidate = actualFacts.find((entry) => factMatches(entry, fact));
    if (!candidate) {
      missing.push(`${fact.kind}:${fact.key ?? fact.value}`);
      continue;
    }
    const sourceSet = new Set(candidate.sourceMessageIds);
    if (fact.sourceMessageIds.some((sourceId) => !sourceSet.has(sourceId))) {
      missing.push(`${fact.kind}:${fact.key ?? fact.value}:source`);
      continue;
    }
    if (fact.kind === "todo" && candidate.status !== fact.status) {
      missing.push(`${fact.kind}:${fact.key ?? fact.value}:status`);
    }
  }
  if (missing.length > 0) {
    throw new ValidationError(`压缩摘要丢失关键事实（${missing.slice(0, 8).join(", ")}）`);
  }
}

/** 校验已持久化摘要的账本哈希；旧摘要没有账本时由上层按 legacy 策略处理。 */
export function assertCriticalFactsHash(facts: CriticalFact[] | undefined, hash: string | undefined): void {
  if (!facts && !hash) return;
  if (!facts || !hash || !/^[a-f0-9]{64}$/i.test(hash) || criticalFactsHash(facts) !== hash.toLowerCase()) {
    throw new ValidationError("上下文摘要关键事实校验失败");
  }
}

function addFact(facts: CriticalFact[], input: Omit<CriticalFact, "id">): void {
  const fact: CriticalFact = { ...input, id: makeFactId(input.kind, input.key, input.value) };
  const index = facts.findIndex((entry) => factIdentity(entry) === factIdentity(fact));
  if (index < 0) {
    facts.push(fact);
    return;
  }
  facts[index] = {
    ...facts[index]!,
    status: input.kind === "todo" ? input.status : facts[index]!.status,
    value: input.kind === "todo" ? input.value : facts[index]!.value,
    sourceMessageIds: unique([...facts[index]!.sourceMessageIds, ...input.sourceMessageIds]),
  };
}

function parseTodo(line: string): { text: string; status: "open" | "done" | "blocked" } | null {
  const match = line.match(/^(?:待办|todo)\s*[:：-]\s*(.+)$/i);
  if (!match?.[1]) return null;
  let text = match[1].trim();
  let status: "open" | "done" | "blocked" = "open";
  if (/^(?:\[x\]|已完成|完成|done)\s*/i.test(text)) {
    status = "done";
    text = text.replace(/^(?:\[x\]|已完成|完成|done)\s*/i, "");
  } else if (/^(?:阻塞|blocked)\s*/i.test(text)) {
    status = "blocked";
    text = text.replace(/^(?:阻塞|blocked)\s*/i, "");
  } else {
    text = text.replace(/^\[\s*\]\s*/, "");
  }
  return text ? { text: text.slice(0, 1_000), status } : null;
}

function parseConflict(line: string): string | null {
  const explicit = line.match(/^(?:冲突|conflict)\s*[:：-]\s*(.+)$/i)?.[1];
  return explicit?.trim().slice(0, 1_000) || null;
}

function factMatches(actual: CriticalFact, expected: CriticalFact): boolean {
  if (actual.kind !== expected.kind) return false;
  if (expected.kind === "todo") return normalize(actual.key ?? actual.value) === normalize(expected.key ?? expected.value);
  return normalize(actual.key ?? "") === normalize(expected.key ?? "") && normalize(actual.value) === normalize(expected.value);
}

function factIdentity(fact: CriticalFact): string {
  return fact.kind === "todo"
    ? `${fact.kind}|${normalize(fact.key ?? fact.value)}`
    : `${fact.kind}|${normalize(fact.key ?? "")}|${normalize(fact.value)}`;
}

function normalizeFacts(facts: CriticalFact[]): CriticalFact[] {
  const seen = new Map<string, CriticalFact>();
  for (const fact of facts) {
    const normalized = cloneFact({
      ...fact,
      key: fact.key ? normalize(fact.key) : null,
      value: normalizeFactValue(fact.value),
      sourceMessageIds: unique(fact.sourceMessageIds),
    });
    const identity = factIdentity(normalized);
    const prior = seen.get(identity);
    seen.set(identity, prior ? {
      ...prior,
      status: normalized.kind === "todo" ? normalized.status : prior.status,
      sourceMessageIds: unique([...prior.sourceMessageIds, ...normalized.sourceMessageIds]),
    } : normalized);
  }
  return Array.from(seen.values()).sort((left, right) => factIdentity(left).localeCompare(factIdentity(right)));
}

function cloneFact(fact: CriticalFact): CriticalFact {
  return { ...fact, sourceMessageIds: [...fact.sourceMessageIds] };
}

function makeFactId(kind: CriticalFact["kind"], key: string | null, value: string): string {
  return `fact-${createHash("sha256").update(`${kind}|${key ?? ""}|${normalize(value)}`).digest("hex").slice(0, 24)}`;
}

function normalizeFactValue(value: string | undefined): string {
  return normalize(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

const IDENTIFIER_PATTERN = /((?:订单号|客户id|项目id|报价单号|合同号|运单号|提单号|(?:订单|客户|项目|报价|合同|运单|提单)\s*(?:编号|id)))\s*[:：#-]?\s*([A-Za-z0-9][A-Za-z0-9_-]{2,127})|\b(?:id)\b\s*[:：#-]?\s*([A-Za-z0-9][A-Za-z0-9_-]{2,127})/gi;
const AMOUNT_PATTERN = /(?:[$¥￥]|USD|CNY|RMB|人民币|美元)\s*[-+]?\d[\d,]*(?:\.\d+)?|[-+]?\d[\d,]*(?:\.\d+)?\s*(?:元|美元|人民币|USD|CNY|RMB)\b/gi;
const DATE_PATTERN = /\b\d{4}(?:[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?)(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/g;
