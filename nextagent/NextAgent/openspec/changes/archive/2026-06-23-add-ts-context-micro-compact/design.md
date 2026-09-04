## 背景和现状（Context）

`add-ts-context-budget-explainability` 和 `add-ts-context-compression` 已经建立了 context assembly 的预算决策门和摘要压缩闭环。`add-ts-large-content-references` 处理了单个超大工具结果的持久化和预览替换。但在"大量中等大小工具结果累积"这一场景下，当前架构缺少轻量级、高频运行的清理机制。

相关方包括 context engine、budget policy、summary compression、gateway persistence 和 model provider adapter。本变更在 `agent-context-engine` 内新增 `micro-compact` 子模块，并扩展 `agent-contracts/context` 和 `agent-contracts/gateway` 的公共契约。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 在 `assemble()` 管线中插入微压缩阶段，位于 history selection 之后、large-content truncation 之前。
- 实现单一路径：in-memory 投影替换，render 阶段重新应用。
- 白名单工具结果可安全清理；非白名单工具结果永远不被触碰。
- 微压缩状态跨请求幂等，摘要压缩后自动清空。
- 与现有 budget gate、large-content truncation、summary compression 无冲突集成。
- 所有失败路径安全降级，不阻塞主管线。

**非目标：**

- 不实现 Session Memory 后台提取或免费压缩路径。
- 不实现 thinking 块清理。
- 不实现 sub-agent 微压缩隔离策略。
- 不修改 `add-ts-large-content-references` 的阈值或决策链。
- 不修改 budget policy 的比例分配或不变量。
- 不引入新的 gateway port。

## 设计决策（Decisions）

### 1. 微压缩作为 request pre-hook 而非事件触发

选择：微压缩在每次 `assemble()` 调用时作为管线阶段运行，而非由 token 阈值或时间条件触发。

理由：微压缩的核心优势是"便宜到可以每轮都跑"。候选识别是纯本地规则（看工具名、看出现顺序、看是否超过阈值、看最近几条是否需要保留），不调用模型，不产生 token 开销。作为管线阶段运行可以确保：

1. 预算门总是看到压缩后的 token 估算，做出更精确的决策。
2. 不存在"微压缩没来得及跑"的窗口期。
3. 与现有管线阶段的执行顺序明确、可测试。

放弃方案：仅在 token 接近阈值时触发。该方案需要额外的 token 估算步骤来决定是否运行微压缩，引入循环依赖（需要估算 → 决定压缩 → 压缩后需要重新估算）。

### 2. 白名单机制而非黑名单或全量扫描

选择：维护一份保守的工具名白名单（8 个工具），只有白名单内的工具结果才进入候选池。

理由：白名单的设计原则是"丢掉后能不能恢复"，而非"内容是否有用"。这个判断属于 Harness 的业务语义，不能委托给模型或通用规则。白名单中的每个工具都满足以下条件之一：

- **可重放**：Read、Grep、Glob、WebFetch、WebSearch — 相同输入可重新获取相同结果。
- **一次性消费**：Bash — 大量输出是日志或命令结果，后续价值递减。
- **写入确认**：FileEdit、FileWrite — 返回值是确认信息，真正状态在文件系统中。

自定义 MCP 工具不在白名单中。Harness 不知道它们是否幂等、是否有副作用、输出是否可重放。一个业务系统查询工具、一段审批流工具、一个写数据库的内部工具，返回内容一旦被擦掉，可能就再也拿不回同一份状态了。

放弃方案：黑名单（排除不可压缩的工具）。黑名单无法穷举所有不可重放的工具类型，且新增工具默认会被错误地纳入候选池。

### 3. 状态持久化在 ActiveContextView 而非 process-local

选择：`MicroCompactState` 作为 `ActiveContextViewRecord.metadata` 的扩展字段持久化，每次 `assemble()` 从 active context 读取。

理由：

1. **与现有不可变 Gateway 模式一致**：NextAgent 的 `DefaultContextEngine` 是无状态的，所有持久化状态通过 gateway 管理。process-local 状态会在进程重启后丢失，导致重复处理或遗漏。
2. **自动作用域隔离**：ActiveContextView 已经按 owner + agent + session 作用域隔离，微压缩状态自然继承这个隔离。
3. **摘要压缩协调**：摘要压缩通过 `commitCompaction` 原子替换 active context，微压缩状态随之清空，无需额外的清理机制。

放弃方案：process-local `Set<string>` 跟踪已处理 ID。该方案在进程重启后丢失状态，且与 NextAgent 的无状态引擎模式冲突。

### 4. 两条路径共用候选识别逻辑

选择：单一路径——in-memory 替换，render 阶段重新应用。

理由：候选识别（白名单过滤、年龄排序、最近窗口保留）是纯函数，与修改方式无关。早期设计曾区分热路径（in-memory only，保护缓存）和冷启动路径（持久化改写），但实际分析发现两条路径在 provider 缓存保护上无差异——最终发给模型的内容都会变化，缓存前缀都会失效。Provider 级缓存保护 deferred 到后续 change。

### 5. 占位符内容设计

选择：替换后的工具结果内容为确定性占位符，包含原始大小信息和可恢复性提示。

```
<compacted-tool-result>
Original size: {originalSize} chars
Tool: {toolName}
This result was compacted to save context budget.
The original content can be re-obtained by re-invoking the tool if needed.
</compacted-tool-result>
```

理由：

1. 占位符是确定性的（相同输入产出相同输出），有利于缓存稳定性。
2. 包含 `originalSize` 和 `toolName` 让模型知道被清理的是什么、有多大。
3. "can be re-obtained by re-invoking" 提示模型在需要时可以重新获取。
4. 不使用 `[Old tool result content cleared]` 这类模糊标记，而是用结构化 XML 标签便于模型解析。

### 6. Provider 缓存保护（deferred）

当前首版不提供 provider 级缓存保护机制。微压缩替换了工具结果内容，最终发给模型的内容变化会导致 provider 缓存前缀失效。真正的缓存保护（如 cache edit directive）需要 provider 侧配合，deferred 到后续 change。

## 详细设计（Detailed Design）

### 模块结构

```
packages/agent-context-engine/src/micro-compact/
  ├── index.ts                 # public barrel
  ├── config.ts                # 常量和配置
  ├── candidate-scanner.ts     # 候选识别（纯函数）
  ├── state-manager.ts         # 状态读写（纯函数 + metadata 投影）
  ├── content-replacer.ts      # 占位符生成（纯函数）
  └── micro-compact.ts         # 主编排（in-memory 替换）
```

### 1. config.ts — 常量和配置

```typescript
/**
 * 白名单工具名。只有这些工具的结果可以进入微压缩候选池。
 * 
 * 设计原则：关心的不是"内容是否有用"，
 * 而是"丢掉后能不能恢复，或者丢掉是否不会伤害主线"。
 */
export const COMPACTABLE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Bash",
  "Read",
  "Grep",
  "Glob",
  "WebFetch",
  "WebSearch",
  "FileEdit",
  "FileWrite",
]);

/**
 * 微压缩配置。
 */
export const MICRO_COMPACT_CONFIG = {
  /** 累积可压缩工具结果超过此数量时触发 */
  triggerThreshold: 10,
  /** 始终保留最近的工具结果数量 */
  keepRecent: 5,
} as const;
```

### 2. candidate-scanner.ts — 候选识别

```typescript
import type { MessageId } from "@nextagent/agent-common";
import type { SessionMessageRecord } from "@nextagent/agent-contracts/gateway";
import { COMPACTABLE_TOOL_NAMES } from "./config.js";

/**
 * 一个可压缩的工具结果候选。
 */
export interface CompactableCandidate {
  readonly messageId: MessageId;
  readonly toolName: string;
  readonly originalContentSize: number;
  /** 在 priorTurnCandidates 中的出现顺序（0-based） */
  readonly orderIndex: number;
}

/**
 * 从 HistorySelectionOutcome 的 priorTurnCandidates 中
 * 识别所有可压缩的工具结果候选。
 *
 * 纯函数：只读取 recordsByMessageId，不修改任何状态。
 * 只扫描 priorTurnCandidates，不扫描 currentRequestRecords
 * （当前请求的工具结果永远不被压缩）。
 */
export function scanCompactableCandidates(
  priorTurnCandidates: readonly MessageId[],
  recordsByMessageId: ReadonlyMap<MessageId, SessionMessageRecord>
): CompactableCandidate[] {
  const candidates: CompactableCandidate[] = [];

  for (let i = 0; i < priorTurnCandidates.length; i++) {
    const messageId = priorTurnCandidates[i]!;
    const record = recordsByMessageId.get(messageId);
    if (record === undefined) continue;
    if (record.role !== "CAPABILITY_RESULT") continue;

    const toolName = extractToolName(record.content);
    if (toolName === undefined) continue;
    if (!COMPACTABLE_TOOL_NAMES.has(toolName)) continue;

    candidates.push({
      messageId,
      toolName,
      originalContentSize: record.content.length,
      orderIndex: i,
    });
  }

  return candidates;
}

/**
 * 从 CAPABILITY_RESULT 记录的 JSON 内容中提取 toolName。
 */
function extractToolName(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.toolName === "string"
    ) {
      return parsed.toolName;
    }
  } catch {
    // not valid JSON — not a capability result we can parse
  }
  return undefined;
}
```

### 3. state-manager.ts — 状态读写

```typescript
import type { MessageId } from "@nextagent/agent-common";

/**
 * 微压缩状态。持久化在 ActiveContextViewRecord.metadata.microCompactState。
 */
export interface MicroCompactState {
  /** 已被标记为压缩的 messageId 集合 */
  readonly compactedIds: readonly string[];
}

/** 空状态常量 */
export const EMPTY_MICRO_COMPACT_STATE: MicroCompactState = {
  compactedIds: [],
};

/**
 * 从 ActiveContextView metadata 中安全读取微压缩状态。
 * 缺失或格式不正确时返回空状态（向后兼容）。
 */
export function readMicroCompactState(
  metadata: Record<string, unknown> | undefined
): MicroCompactState {
  if (metadata === undefined) return EMPTY_MICRO_COMPACT_STATE;
  const raw = metadata["microCompactState"];
  if (!isPlainObject(raw)) return EMPTY_MICRO_COMPACT_STATE;
  const ids = raw["compactedIds"];
  if (!Array.isArray(ids)) return EMPTY_MICRO_COMPACT_STATE;
  const validIds = ids.filter(
    (id): id is string => typeof id === "string" && id.length > 0
  );
  return { compactedIds: validIds };
}

/**
 * 将微压缩状态投影到 metadata 对象中。
 * 返回新的 metadata 对象（不修改原对象）。
 */
export function writeMicroCompactState(
  metadata: Record<string, unknown>,
  state: MicroCompactState
): Record<string, unknown> {
  return {
    ...metadata,
    microCompactState: {
      compactedIds: [...state.compactedIds],
    },
  };
}

/**
 * 清空微压缩状态。摘要压缩成功后调用。
 */
export function clearMicroCompactState(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const { microCompactState: _, ...rest } = metadata;
  return rest;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

### 4. content-replacer.ts — 占位符生成

```typescript
/**
 * 生成微压缩占位符内容。
 * 
 * 占位符是确定性的（相同输入产出相同输出），
 * 包含原始大小和工具名，便于模型理解被清理的内容。
 */
export function renderCompactedPlaceholder(params: {
  readonly originalSize: number;
  readonly toolName: string;
}): string {
  return [
    "<compacted-tool-result>",
    `Original size: ${params.originalSize} chars`,
    `Tool: ${params.toolName}`,
    "This result was compacted to save context budget.",
    "The original content can be re-obtained by re-invoking the tool if needed.",
    "</compacted-tool-result>",
  ].join("\n");
}

/**
 * 替换 CAPABILITY_RESULT 记录中的 payload 为占位符。
 * 保持 JSON 结构（toolCallId / toolName）不变，
 * 只替换 payload 字段。
 */
export function replaceCapabilityResultPayload(
  rawContent: string,
  placeholder: string
): string {
  try {
    const parsed = JSON.parse(rawContent);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.toolCallId === "string"
    ) {
      parsed.payload = { compacted: placeholder };
      return JSON.stringify(parsed);
    }
  } catch {
    // not valid JSON — fall through to full replacement
  }
  return placeholder;
}
```

### 5. micro-compact.ts — 主编排

```typescript
import type { MessageId } from "@nextagent/agent-common";
import type { SessionMessageRecord } from "@nextagent/agent-contracts/gateway";
import type { HistorySelectionOutcome } from "../assembly/active-context-selector.js";
import {
  scanCompactableCandidates,
  type CompactableCandidate,
} from "./candidate-scanner.js";
import {
  readMicroCompactState,
  writeMicroCompactState,
  type MicroCompactState,
} from "./state-manager.js";
import {
  renderCompactedPlaceholder,
  replaceCapabilityResultPayload,
} from "./content-replacer.js";
import { MICRO_COMPACT_CONFIG } from "./config.js";

/**
 * 微压缩执行结果（engine 内部类型，不暴露在 agent-contracts 中）。
 */
export interface MicroCompactResult {
  readonly newlyCompactedCount: number;
  readonly totalCompactedCount: number;
  readonly retainedCount: number;
  readonly path: "no-op" | "compacted";
  readonly safeReason: string;
}

/** Utility: strip readonly modifiers for in-place mutation. */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * 微压缩主编排。
 *
 * 在 history selection 之后、large-content truncation 之前调用。
 * 修改 HistorySelectionOutcome.recordsByMessageId 中的记录内容（in-place），
 * 使后续的 budget evaluation 看到压缩后的 token 估算。
 *
 * @param outcome  - history selection 的输出
 * @param metadata - ActiveContextViewRecord.metadata（用于读取状态）
 * @returns { evidence, updatedMetadata }
 */
export function microcompactHistory(params: {
  readonly outcome: HistorySelectionOutcome;
  readonly metadata: Record<string, unknown> | undefined;
}): {
  readonly evidence: MicroCompactResult;
  readonly updatedMetadata: Record<string, unknown>;
} {
  const { outcome, metadata } = params;
  const state = readMicroCompactState(metadata);
  const compactedIdSet = new Set(state.compactedIds);

  // 1. 扫描所有可压缩候选
  const allCandidates = scanCompactableCandidates(
    outcome.priorTurnCandidates,
    outcome.recordsByMessageId
  );

  // 2. 区分已压缩和 fresh 候选
  const freshCandidates = allCandidates.filter(
    (c) => !compactedIdSet.has(c.messageId)
  );

  // 3. 计算总数 = 已压缩 + fresh（全部可压缩且未被之前轮次处理的）
  const totalCompactable = allCandidates.length;

  // 4. 判断是否触发
  if (totalCompactable <= MICRO_COMPACT_CONFIG.triggerThreshold) {
    return {
      evidence: {
        newlyCompactedCount: 0,
        totalCompactedCount: compactedIdSet.size,
        retainedCount: totalCompactable,
        path: "no-op",
      },
      updatedMetadata: metadata ?? {},
    };
  }

  // 5. 按出现顺序排序全部可压缩候选
  const sortedByOrder = [...allCandidates].sort(
    (a, b) => a.orderIndex - b.orderIndex
  );

  // 6. 保留最近 keepRecent 个，其余标记为压缩
  const keepCount = Math.min(
    MICRO_COMPACT_CONFIG.keepRecent,
    sortedByOrder.length
  );
  const toCompact = sortedByOrder.slice(
    0,
    sortedByOrder.length - keepCount
  );
  const retained = sortedByOrder.slice(sortedByOrder.length - keepCount);

  // 7. 执行替换
  const newlyCompactedIds: string[] = [];
  for (const candidate of toCompact) {
    if (compactedIdSet.has(candidate.messageId)) continue; // 已经压缩过

    const placeholder = renderCompactedPlaceholder({
      originalSize: candidate.originalContentSize,
      toolName: candidate.toolName,
    });

    // 替换 recordsByMessageId 中的内容（in-place mutation，
    // 与 truncateLargeToolResults 同一模式）
    const record = outcome.recordsByMessageId.get(candidate.messageId);
    if (record !== undefined) {
      const replaced = replaceCapabilityResultPayload(
        record.content,
        placeholder
      );
      (record as Writable<SessionMessageRecord>).content = replaced;
    }

    compactedIdSet.add(candidate.messageId);
    newlyCompactedIds.push(candidate.messageId);
  }

  // 8. 更新状态
  const newState: MicroCompactState = {
    compactedIds: [...compactedIdSet],
  };
  const updatedMetadata = writeMicroCompactState(
    metadata ?? {},
    newState
  );

  return {
    evidence: {
      newlyCompactedCount: newlyCompactedIds.length,
      totalCompactedCount: compactedIdSet.size,
      retainedCount: retained.length,
      path: "compacted",
      safeReason: "COMPACTION_APPLIED",
    },
    updatedMetadata,
  };
}

/**
 * render 阶段重新应用微压缩替换。
 *
 * render 从 messageStore 加载原始记录（完整内容），
 * 需要对已压缩的 messageId 重新应用占位符替换。
 * 这与 truncateRenderedToolResults 同级运行。
 */
export function applyMicroCompactReplacementAtRender(
  messages: readonly { readonly messageId?: string; readonly role: string; content: unknown }[],
  compactedIds: ReadonlySet<string>
): void {
  for (const message of messages) {
    if (message.messageId === undefined) continue;
    if (!compactedIds.has(message.messageId)) continue;
    if (message.role !== "TOOL" || !Array.isArray(message.content)) continue;

    for (let i = 0; i < message.content.length; i++) {
      const part = message.content[i];
      if (part === undefined || part.type !== "tool-result") continue;
      const outputStr =
        typeof part.output === "string"
          ? part.output
          : JSON.stringify(part.output);

      // 提取 toolName（如果可用）
      const toolName =
        typeof (part as Record<string, unknown>).toolName === "string"
          ? ((part as Record<string, unknown>).toolName as string)
          : "unknown";

      const placeholder = renderCompactedPlaceholder({
        originalSize: outputStr.length,
        toolName,
      });

      (message.content as Writable<typeof message.content>)[i] = {
        ...part,
        output: { compacted: placeholder },
      };
    }
  }
}
```

### 6. 管线集成（assemble-context.ts 修改）

```typescript
// 在 DefaultContextEngine.assemble() 中：

async assemble(request: ContextAssemblyRequest): Promise<ContextAssembly> {
  // Step 1: Load context state (existing)
  const active = await this.loadActiveContextOrEmpty(owner, request);
  const assembly = await this.deps.assemblyRegistry.require(...);
  const visibleCapabilities = await this.resolveCapabilities(...);
  const modelSelection = this.resolveModelSelection(...);
  const promptAssembly = await this.assemblePrompt(...);
  const systemPrompt = promptAssembly.systemPrompt;

  // Step 2: History selection (existing)
  const selectionOutcome = await this.selectHistory(...);

  // Step 2.3: Micro-compact (NEW)
  const microCompactResult = microcompactHistory({
    outcome: selectionOutcome,
    metadata: active?.metadata,
  });
  this.deps.diagnosticLogger?.info(
    {
      event: "context.microCompact.evaluated",
      path: microCompactResult.evidence.path,
      newlyCompacted: microCompactResult.evidence.newlyCompactedCount,
      totalCompacted: microCompactResult.evidence.totalCompactedCount,
      retained: microCompactResult.evidence.retainedCount,
    },
    "micro-compact evaluated"
  );

  // Step 2.5: Large-content guard (existing)
  this.truncateLargeToolResults(selectionOutcome);

  // Step 3: Budget evaluation (existing)
  const budgetOutcome = this.evaluateBudget(...);
  const compressionOutcome = await this.processBudgetOutcome(...);

  // Step 4: Build final assembly result (existing)
  return this.buildAssemblyResult(...);
}
```

### 7. render 阶段集成

```typescript
// 在 DefaultContextEngine.render() 中：

async render(assembly: ContextAssembly): Promise<RenderedModelInput> {
  // ... existing batch load ...

  const rendered = await new DefaultModelInputRenderer(...).render({...});

  // Large-content guard (existing)
  truncateRenderedToolResults(rendered.messages);

  // Micro-compact replacement (NEW)
  const activeReload = await this.loadActiveContextOrEmpty(owner, assembly.request);
  const compactedIds = new Set(
    readMicroCompactState(activeReload?.metadata).compactedIds
  );
  if (compactedIds.size > 0) {
    applyMicroCompactReplacementAtRender(rendered.messages, compactedIds);
  }

  return rendered;
}
```

### 8. 摘要压缩后清空状态

```typescript
// 在 summary-compression-orchestrator.ts 的 commitCompaction 成功后：

// commitCompaction 原子替换 active context 为 summary + retained tail。
// 新的 ActiveContextView 不包含旧的 prior history，
// 因此 micro-compact 状态中的 compactedIds 大部分已无效。
// 
// 保留的 retained tail 中的工具结果会被下一次 assemble()
// 的 scanCompactableCandidates 重新扫描并注册。
// 
// 因此：commitCompaction 后的新 metadata 中不包含
// microCompactState 字段（由 clearMicroCompactState 处理）。
```

## 测试策略

### 单元测试

| 测试场景 | 覆盖模块 | 验证点 |
|---|---|---|
| 白名单过滤 | `candidate-scanner.ts` | 只有 8 个白名单工具的 CAPABILITY_RESULT 被识别 |
| 非白名单工具排除 | `candidate-scanner.ts` | MCP 工具、Agent 工具不被识别 |
| currentRequest 不扫描 | `candidate-scanner.ts` | 当前请求的工具结果永远不被压缩 |
| 阈值不触发 | `micro-compact.ts` | ≤10 个候选时不执行替换 |
| 保留最近 5 个 | `micro-compact.ts` | 15 个候选时压缩最旧的 10 个，保留最近 5 个 |
| 幂等性 | `micro-compact.ts` | 同一 messageId 不被重复标记 |
| 占位符确定性 | `content-replacer.ts` | 相同输入产出相同占位符 |
| JSON 结构保持 | `content-replacer.ts` | toolCallId / toolName 不变，只替换 payload |
| 非 JSON 内容降级 | `content-replacer.ts` | 无法解析时整体替换为占位符 |
| 空状态向后兼容 | `state-manager.ts` | metadata 缺失 microCompactState 时返回空状态 |
| 状态投影不可变 | `state-manager.ts` | writeMicroCompactState 不修改原 metadata |

### 集成测试

| 测试场景 | 验证点 |
|---|---|
| 微压缩 + budget gate | 微压缩后 budget gate 看到更小的 token 估算，减少 HISTORY_OMITTED |
| 微压缩 + large-content | 微压缩先运行，已被压缩的结果不再进入 large-content 处理 |
| 微压缩 + summary compression | 摘要压缩后微压缩状态被清空 |
| render 阶段重新应用 | render 从 store 加载原始内容后，微压缩替换被重新应用 |

### 架构边界测试

| 测试场景 | 验证点 |
|---|---|
| 不导入 provider SDK | micro-compact 子模块不依赖任何 provider 实现 |
| 不修改 gateway port | 不新增 gateway port |
| 不修改 budget policy | 不改变 budget policy 的比例分配或不变量 |

## 配置参考

```yaml
# agent.yaml — 微压缩相关（未来可通过 runtimeSettings 配置）
runtimeSettings:
  microCompact:
    triggerThreshold: 10    # 累积可压缩工具结果触发阈值
    keepRecent: 5           # 保留最近工具结果数量
```

当前首版使用硬编码常量，后续 change 可通过 `runtimeSettings` 或 app composition 注入配置。
