# 上下文管理

这一篇讲上下文引擎（`agent-context-engine`）：它负责什么、一次装配怎么走、窗口与预算怎么管、上下文怎么压缩、大内容怎么外置、token 怎么估。

## 上下文引擎职责

Context Engine（`packages/agent-context-engine`）负责为每次模型调用构建查询上下文：

- 接收 `ContextAssemblyRequest`（仅含 request/run/step 定位 + identity + purpose + flowVariables + capabilityContextPatch）
- **自行选择**模型可见历史（current-request 与 prior-turn candidates）
- 解析 purpose-aware 提示模板 + 应用查询策略与预算门控
- 渲染最终用于模型调用的 `RenderedModelInput`（`messages` + `tools` + `modelInfo`/`modelOptions`/`providerOptions`）

> 关键设计：Context Engine **自行选择**上下文，调用方不预选类别或条目。`ContextAssemblyRequest` 只传 location + intent + 可选 patch，不传预选的历史/附件/记忆引用。

> Context Assembly **不自动**检索或注入长期记忆。模型需要记忆时，通过 governed memory tools（`search_memory` / `get_memory_detail` / `add_memory` 等）显式调用。memory guidance 系统提示 section 仅在 memory tool capability 对当前 accepted agent 可见时渲染。

## ContextAssemblyRequest

`ContextAssemblyRequest`（`packages/agent-contracts/src/context`）的真实 shape：

```typescript
interface ContextAssemblyRequest {
  sessionId: SessionId;
  requestId: MessageId;            // 当前请求根用户消息 ID
  requestContextId: RequestContextId;
  identityContext: IdentityContext; // 可信 owner scope
  agentId: AgentId;
  agentVersion: AgentVersion;       // accepted run 固化的 assembly 版本
  runId: RequestRunId;
  stepId: string;
  locale: RequestLocale;
  purpose: string;                  // PromptPurpose，如 SYSTEM_PROMPT
  flowVariables?: Readonly<Record<string, string>>;
  capabilityGeneratedMessages?: readonly CapabilityGeneratedMessage[];
  capabilityContextPatch?: CapabilityContextPatch; // allowedTools / modelId / modelOptions 透传
}
```

注意：**不包含**预选的 history/attachment/memory 引用。所有选择由 Context Engine 完成。

`ContextEnginePort` 暴露两个阶段：

```typescript
interface ContextEnginePort {
  assemble(request: ContextAssemblyRequest): Promise<ContextAssembly>;
  render(assembly: ContextAssembly): Promise<RenderedModelInput>;
}
```

## 装配流程（assemble）

`DefaultContextEngine.assemble`（`src/assembly/assemble-context.ts`）的 pipeline：

```
Step 1  加载上下文状态
        ├─ loadActiveContextOrEmpty (owner+agent+session scoped)
        ├─ assemblyRegistry.require(agentId, agentVersion)
        ├─ resolveCapabilities (capability catalog + capabilityContextPatch)
        ├─ resolveModelSelection (canonical model 兼容性校验)
        └─ assemblePrompt (purpose-aware 提示模板装配 → SystemPrompt)

Step 2  历史选择 (selectHistory)
        ├─ 从 active context snapshot 加载消息
        ├─ 解析 current-request records (root user + 同 requestId/runId 的协议消息)
        ├─ groupPriorTurns → 保留完整可见 turn，丢弃 hidden replacement / 不完整 turn
        └─ 不在此处截断；只产出 candidates

Step 2.3 micro-compact (见下文)
Step 2.5 large-content guard — 超大 CAPABILITY_RESULT 替换为 bounded preview
Step 3  budget evaluation (预算门控 + 诊断 + 压缩)
Step 4  buildAssemblyResult → ContextAssembly
```

`ContextAssembly` 产物包含 `systemPrompt`、`selectedMessageRefs`、`visibleCapabilities`、`modelInfo`/`modelOptions`/`modelSelectionReason`，以及可选的 `budgetPlan`/`budgetEvidence`/`budgetRoleEvidence`/`compressionEvidence`/`attachmentEvidence`/`attachmentDegradationEvidence`。

## 历史选择策略

历史选择（`src/assembly/active-context-selector.ts` + `assemble-context.ts`）的不变量：

1. 只读单个 active-context snapshot，不在 snapshot 之外调用 `loadMessage`。
2. 先解析 current-request records（`requestId` 标识的 root user message + 同 `requestId`/`runId` 的协议必需消息）。current-request anchor 不可解析时显式失败（`CONTEXT_CURRENT_REQUEST_UNRESOLVABLE`）。
3. 按 `requestId` 分组前序对话，只保留完整可见 turn：root user → 有序 tool-use / capability-result → 终态 assistant（或 SUMMARY）响应。hidden replacement、pending tool fragment、不完整 turn 整体丢弃。
4. 此处不做截断——最终 `selectedMessageRefs` 的截断由预算门控 + 压缩阶段拥有。
5. 每个 ref 锚定同一 `activeContextVersion`。

> 前序对话查询**不包含** `maxWindowUnits` 参数，窗口预算完全由 Context Engine 与预算策略控制，确保上下文选择逻辑集中、可测试、可替换。

## 上下文预算（Budget）

### 预算门控

预算门控（`src/budget/`）在 `budgetPolicy` 被组合时执行：

- `buildSourceCandidates` 构造每类来源候选（system / user / assistant / tool / attachment），用 `TokenEstimator` 估算 input units。
- `ContextBudgetPolicyPort.evaluate(policyInput)` 输出 `ContextBudgetPolicyOutcome`（`plan` + `evidence` + `roleEvidence`）。
- `plan.decision` 为 `explicit_failure` 时抛 `CONTEXT_INSUFFICIENT_BUDGET`（例如 `MINIMUM_SAFE_CONTEXT_EXCEEDS_BUDGET`）。
- 预算 evidence 标记 prior_active_history 的 `omitted` / `selected` / `degraded`，`assemble-context` 据此过滤候选并修复 tool-call/tool-result orphan。

### 配置

预算窗口来自 `modelInfo.contextWindowTokens` 与 `modelOptions.maxOutputTokens`：

```
availableInputUnits = max(0, contextWindowTokens - reservedOutput)
```

`maxContextMessages` 在 `agent.yaml` 的 `runtimeSettings` 中配置（默认 50）。`maxTurns`（模型回合上限，默认 50）、`maxToolCallsPerTurn`（单回合 Tool 调用上限）与 `requestTimeoutMs`（默认 1800000）也由 `runtimeSettings` 控制。

## 上下文压缩（Compaction）

NextAgent 的压缩是**多层互补**机制，按真实代码组织如下。旧文档中编造的"三层 Summary DAG / SummaryDAGStore / importanceScore"概念在代码中**不存在**，已删除。

### Layer 1：Micro-compact（微压缩）

`src/micro-compact/` —— 在每次 `assemble()` 的历史选择后、large-content 截断与预算评估前运行，纯本地规则，无模型调用。

- **白名单工具**（`COMPACTABLE_TOOL_NAMES`，小写）：`bash`、`read`、`grep`、`glob`、`write`、`python`。自定义 MCP 工具、Agent 编排工具、Task 工具永不被触碰。
- **触发条件**：累积可压缩 tool result > `triggerThreshold`（10）。
- **保留窗口**：始终保留最近 `keepRecent`（5）个 tool result，清理最旧的超出部分。
- **幂等性**：同一 `messageId` 不会被重复压缩；`compactedIds` 状态持久化在 active context metadata 上，render 阶段重新应用占位符替换。
- **失败降级**：micro-compact 失败 MUST NOT 阻断 pipeline，记录 `context.microCompact.failed` 后继续。

```
assemble() pipeline:
  selectHistory → microcompactHistory → truncateLargeToolResults → evaluateBudget → ...
```

### Layer 2：Large-content truncation（大内容截断）

`src/large-content/` —— 对单个超大的 `CAPABILITY_RESULT` 内容，在预算评估前替换为 bounded preview，使 token estimator 看到 ~2KB preview 而非 30KB+ 原文。

- 阈值（`LARGE_CONTENT_THRESHOLDS`）：`inlineMaxBytes=50000`、`aggregateMaxBytes=16384`、`previewMaxChars=2048`。
- 替换决策顺序：`EMPTY_MARKER` → `SPECIALIZED_REF` → `PERSISTED_PREVIEW` → `INLINE`。
- 保留 JSON 结构（`toolCallId`/`toolName`），只替换 payload 为 `{preview: ...}`。
- **Infinity tools**（默认空集）永不外置/截断；`Read` 默认不再豁免，超阈值结果走常规 `PERSISTED_PREVIEW` 外置，模型可通过 contentRef 用 `Read` offset/limit 回读分页。
- 原始内容保留在 message store，render 阶段重新应用截断（因 render 重新从 store 加载原文）。

### Layer 3：Summary compression（摘要压缩）

`src/summary/` —— 当对话接近窗口上限时，把前序 turn 压缩为 SUMMARY 消息。

- **唯一触发条件**：proactive context-window threshold。当 `sumEvidenceUnits(budgetEvidence) >= availableInputUnits - DEFAULT_AUTO_COMPACT_HEADROOM_UNITS`（约窗口 90–92%）时触发。`availableInputUnits <= headroom`（小窗口）时不触发。
- 需要 `summaryGenerator`（`TraceableSummaryGenerationPort`）+ `commitCompaction` + `idFactory` 全部被组合，否则降级为 omission（`SUMMARY_GENERATOR_UNCONFIGURED`）。
- **切分策略**（`splitPriorTurnCandidatesForCompression`）：2+ 个完整 prior turn 时，最后一个 turn 作为 retained tail 原文保留，前面的 turn 被覆盖生成摘要；只有 1 个 prior turn 时全部覆盖，retained tail 为空。
- 摘要消息作为 `SUMMARY` role 写入，`selectedMessageRefs = [summaryMessageId, ...retainedTailRefs, ...currentRefs]`。
- 提交通过 `commitCompaction` hook（owner+agent+session scoped，带 `expectedActiveContextVersion` 与 `idempotencyKey`），下游 `CONTEXT_COMPACTED` checkpoint 幂等记录。

> Summary compression 通过 `TraceableSummaryGenerationPort` 调用模型生成摘要，语义生成与压缩提交分离（见 `context-engine` spec H2-b）。

## Token 估算

`TokenEstimator` 契约（`src/budget/default-token-estimator.ts`，见 `context-token-estimator` spec）：

- `DefaultTokenEstimator` 使用 code-point-aware 加权（中文/非 ASCII 权重高于 ASCII），并为每条消息加协议开销。
- `mapRoleToTokenEstimatorRole`：`USER→user`、`ASSISTANT→assistant`、`CAPABILITY_RESULT→tool`、`SUMMARY→system`。
- 估算结果用于预算门控与压缩触发判断。`estimatedConversationInputUnits` 复用预算门控的 per-candidate evidence，**不**走第二个 estimator。

## 渲染流程（render）

`DefaultContextEngine.render`（`src/render/` + `src/prompt-shaping/`）：

```
ContextAssembly
  ↓
1. assemblyRegistry.require(agentId, agentVersion) — 重新解析 accepted assembly
2. messageStore.loadMessages(selectedMessageRefs) — 单次批量加载，禁止 N+1
3. 重新应用 micro-compact 占位符（compactedIds）
4. 校验 ref 仍存在且 model-visible（visible=false 但 ASSISTANT_TOOL_USE 允许）
5. 解析 attachment descriptor sequence（attachmentStore，可选）
6. DefaultModelInputRenderer.render → ModelMessage 列表 + tools
7. truncateRenderedToolResults（render 重新加载原文后再次截断）
  ↓
RenderedModelInput { messages, tools, modelInfo, modelOptions, providerOptions }
```

- missing ref 抛 `CONTEXT_RENDER_MESSAGE_UNRESOLVABLE`，不静默丢弃。
- `SYSTEM_PROMPT_CACHE_BOUNDARY_MARKER`（`---[CACHE_BOUNDARY]---`）分隔 stable / dynamic section，利于 prompt cache。

## 大内容外置与读回

### 外置（large-content-references）

按统一大小策略，超阈值的内容 externalize 为 owner-scoped `ContentRef`（见 `large-content-references` spec）：

- **oversized textual `CAPABILITY_RESULT`**：外置为 execution workspace 文件 `tool-results/<refId>.txt`，`ContentRef.refId` 即该相对路径。
- **二进制附件 / blob-backed 来源**：以 `BlobRef` 形式由 `BlobStoreGateway` 在 owner scope 边界持有。
- replacement evidence 写入 `SessionMessage.metadata.replacement`，决策冻结——同批次与跨轮重放原样复用，不重新计算阈值（保 prompt cache 命中）。
- 当前请求必需内容（USER current request + latest-request-critical）MUST NOT 被静默截断/丢弃；装不下时返回显式 insufficient-context outcome。

### 读回（large-content-readback）

模型通过现有 `read` 工具分页读回外置内容（见 `large-content-readback` spec）：

- `read` 工具以 `file_path = tool-results/<refId>.txt` 调用，复用 `offset`/`limit`/`truncated`/`nextOffset` 语义。
- 单次读取超限时返回 safe paging-required error，不静默截断。
- `read` 工具本身**豁免**外置（防止 read-readback-externalize-readback 循环）。
- owner scope 通过 execution workspace resolver 强制（`tenantId`/`subjectId`/`sessionId`）；跨 scope 返回 `FILE_UNAVAILABLE`，不泄露原内容。

## Prompt Template Assembly

purpose-aware 提示模板装配（`src/prompt-shaping/`，见 `prompt-template-assembly` spec）：

- `PromptPurpose` 是 validated string scalar（非封闭 enum），well-known 常量含 `SYSTEM_PROMPT`、`SUMMARY_GENERATION`、`MEMORY_EXTRACTION`，开发者可定义自定义 purpose。
- `PromptTemplateAssembler.assemble({ purpose, agentId, agentVersion, locale, flowVariables, selectedModel, memoryEnabled })` → ordered section 渲染 + model options override。
- `SYSTEM_PROMPT` 是受限高风险 purpose，叠加 section / cache-boundary / 角色约束。
- memory guidance section 仅在 `memoryToolCapabilityId` 对 accepted agent 可见时渲染。

## 智能体开发者的关注点

### 通过提示模板控制上下文

提示模板的 stable section 越小，留给对话历史的空间越大。利用 `flowVariables` 注入运行时变量。

### 控制长期记忆

Context Assembly 不自动注入记忆。模型需要记忆时显式调用 governed memory tools：

```
search_memory    → 检索相关记忆
get_memory_detail → 读取记忆详情
add_memory       → 写入新记忆
```

记忆相关配置在 `default-system.yaml` 的 `nextAgent.memory.*`（不是旧的 `adnclaw-system.properties`）：

```yaml
nextAgent:
  memory:
    enabled: true
    search:
      default-limit: 20
      min-confidence: 0.3
    extraction:
      enabled: true
      strategy: RULE_FIRST
      crossSessionSchedule: "0 0 0 * * ?"
      maxCycleTrajectories: 20
      maxCandidates: 50
      timeoutMs: 60000
      lookbackDays: 7
    aging:
      enabled: true
      schedule: "0 0 0 * * ?"
      decayStaleDays: 30
      archiveRetentionDays: 90
      decayFactor: 0.05
      batchLimit: 1000
      timeoutMs: 30000
      reviveConfidenceBoost: 0.1
```

### 上下文策略建议

1. 精简提示模板 stable sections，给对话历史留预算。
2. 设置合理的 `maxTurns`（默认 50）与 `maxToolCallsPerTurn`，防止工具循环占用上下文。
3. 依赖 micro-compact / large-content / summary compression 三层自动管理窗口，不要在 capability 中手动截断历史。
4. 大 tool result 会自动外置为 workspace 文件并由模型按需 `read` 读回，无需业务侧干预。

## 配置参考

`agent.yaml`（`runtimeSettings`，见 `packages/agent-core/src/builtin-agents/default-agent/agent.yaml`）：

```json
{
  "defaultModelId": "MiniMax-M2.7-highspeed",
  "runtimeSettings": {
    "defaultLanguage": "zh-CN",
    "maxTurns": 50,
    "maxToolCallsPerTurn": 30,
    "maxContextMessages": 50,
    "requestTimeoutMs": 1800000
  }
}
```

应用级 system config 由框架 `default-system.yaml` 与开发者 `application.yaml` 合成，包含 `modelProfiles[].models[]`（子模型可声明 `contextWindowTokens`）、`gateway`、`nextAgent.memory.*` 等。**不存在** `adnclaw-system.properties`；记忆配置统一在 `nextAgent.memory.*` 下。

## 相关资源

- OpenSpec specs：`context-engine/`、`context-assembly-contracts/`、`context-token-estimator/`、`large-content-references/`、`large-content-readback/`、`prompt-template-assembly/`
- 提示工程：[提示工程](./06-prompt-engineering.md)
- 会话与状态管理：[会话与状态管理](./07-session-state-management.md)
- 流式事件（含 `CONTEXT_COMPACTED`）：[流式事件](./09-streaming-events.md)
