## Context

`tryEmitToolStructuredDelta` 在 `agent-core/src/tools/tool-loop.ts` 中，capability 执行完成后被调用。当前识别逻辑分两条分支：

1. `isClipProvider(descriptor)`：CLIP custom capability provider，候选 = `structuredPayload` 本身，用 `isClipStructuredEvent` 检测直接三元组。
2. `descriptor.capabilityId === bashCapabilityId`：Bash tool，候选 = `structuredPayload.stdout` 经 JSON.parse，用 `extractClipcStructuredEvent` 检测信封包裹的三元组。

线上 clipc 统一走 Bash 调用，CLIP provider 路径不再使用。新增 ApiCall 工具通过 HTTP 调用后端 API，返回结果可能直接是结构化事件或信封包裹。Bash 调 curl 也可能直接输出结构化事件。需要将识别范围扩展到 Bash + ApiCall，并统一支持直接和信封两种形状。

## Goals / Non-Goals

**Goals**

- 白名单扩展为 CLIP provider（legacy 保留）+ Bash + ApiCall
- 共享形状检测：直接三元组（`isStructuredEvent`）+ 信封解包（新增 `unwrapStructuredEnvelope`）
- Bash 同时支持直接形状和信封形状（现有只支持信封）
- ApiCall 非流式：编排层（`default-agent.ts`）在 `capabilityInvocation.invoke()` 返回后对 `structuredPayload` 做结构识别
- ApiCall 流式：编排层传 `runtimeContext.emitResultDelta` 回调，在回调中逐块 `chunk.data` 做结构识别
- 共享逻辑抽到独立模块 `structured-delta-identification.ts`

**Non-Goals**

- 不清理 CLIP provider 整套代码
- 不改 `structured-delta-safety.ts`
- 不改持久化策略（`runTimelineEventPersistencePolicy`）
- 不改前端
- 不做历史回放
- 不处理跨帧累积拼接的流式场景

## Decisions

### 决策 1：白名单而非通用判断

`TOOL_STRUCTURED_DELTA` 直接驱动前端渲染，误判代价是 UI 乱。白名单边界明确：CLIP provider（legacy）+ Bash + ApiCall。白名单外工具不尝试识别，走默认 `CAPABILITY_RESULT_DELTA`。

### 决策 2：共享形状检测分层

将识别逻辑抽到独立模块 `packages/agent-core/src/tools/structured-delta-identification.ts`，分为三层：

```
Layer 1: 候选提取（tool-specific）
  Bash:    JSON.parse(structuredPayload.stdout) → candidate (object)
  ApiCall: structuredPayload 本身 → candidate (object)
  CLIP:    structuredPayload 本身 → candidate (object)

Layer 2: 形状检测（shared）
  直接: isStructuredEvent(candidate)
  信封: unwrapStructuredEnvelope(candidate) → isStructuredEvent(inner)
  统一: identifyStructuredDelta(candidate) — 先试直接，再试信封

Layer 3: 安全 + emit（shared）
  emitStructuredDeltaData(runState, run, context, capabilityId, toolCallId, structured)
  → hasSensitiveStructuredContent 检查 → emit TOOL_STRUCTURED_DELTA
``+
模块导出：
- `isStructuredEvent`：直接三元组校验（复用 `TOOL_EVENT_TYPES`/`TOOL_MESSAGE_TYPES`）
- `unwrapStructuredEnvelope`：信封解包纯函数
- `identifyStructuredDelta`：统一形状检测，先试直接再试信封
- `tryEmitStructuredDelta`：候选 → 识别 → 安全检查 → emit（编排层用）
- `emitStructuredDeltaData`：已识别的 StructuredDeltaData → 安全检查 → emit（tool-loop 用）

### 决策 3：Bash 同时支持直接和信封

重构 `extractClipcStructuredEvent` 为：预检 + `JSON.parse(stdout)` → `identifyStructuredDelta(candidate)`。预检保留 `startsWith("{")`，去掉硬编码子串检测。

### 决策 4：ApiCall 非流式检测在编排层

ApiCall 工具是 non-agentic 路径，由编排层（`default-agent.ts`）直接调 `capabilityInvocation.invoke()`，不经过 `executeToolCallsInOrder`。因此非流式终态检测必须在编排层做：

```
default-agent.ts:
  apiResult = await capabilityInvocation.invoke({...}, signal, runtimeContext)
  await tryEmitStructuredDelta(runState, run, context, "ApiCall", stepId, apiResult.structuredPayload)
```

### 决策 5：ApiCall 流式逐块检测在编排层 runtimeContext 回调

编排层传 `runtimeContext.emitResultDelta` 回调，ApiCall 工具流式执行时每个 SSE chunk 调用此回调。回调中对 `chunk.data`（string）做 `JSON.parse` → `identifyStructuredDelta` → 匹配则 emit `TOOL_STRUCTURED_DELTA`。

```
default-agent.ts runtimeContext:
  emitResultDelta: async (payload) => {
    chunkData = payload.structuredPayload["data"]
    if (typeof chunkData === "string") {
      candidate = JSON.parse(chunkData)
      await tryEmitStructuredDelta(runState, run, context, "ApiCall", stepId, candidate)
    }
  }
``

流式终态 `structuredPayload` 为空对象 `{}`，`tryEmitStructuredDelta` 检测不到，不重复 emit。

### 决策 6：tool-loop.ts 瘦身

从 `tool-loop.ts` 移除：
- `clipStructuredEventTypes` / `clipStructuredMessageTypes`（重复定义，改用 `TOOL_EVENT_TYPES`/`TOOL_MESSAGE_TYPES`）
- `isClipStructuredEvent`（被 `isStructuredEvent` 替代）
- `unwrapStructuredEnvelope` / `identifyStructuredDelta`（移到独立模块）
- `tryEmitApiCallStreamStructuredDelta`（ApiCall 不走 tool-loop）
- `apiCallCapabilityId`（ApiCall 不走 tool-loop）
- `hasSensitiveStructuredContent` import（不再直接使用）

`tryEmitToolStructuredDelta` 保留但重构：CLIP/Bash 候选提取后调 `emitStructuredDeltaData` 共享 emit。

### 决策 7：CLIP provider 保留不动

CLIP provider 分支代码和 `projectClipCapabilityResultSafeFields` 保留不动。spec 中标注为 legacy path。

## Quality Attributes

| 属性 | 要求 | 验证方式 |
|---|---|---|
| 安全 | 复用 `hasSensitiveStructuredContent`；JSON.parse 包裹 try-catch | 测试：敏感内容不 emit |
| 性能 | Bash 预检过滤非 JSON stdout；ApiCall 只在白名单内尝试 | 测试：普通输出不触发 |
| 兼容 | 不影响现有 CAPABILITY_RESULT_DELTA 和 CAPABILITY_COMPLETED 的 emit 顺序 | 测试：所有 event 正常 emit |
| 实时性 | 流式逐块检测，匹配即 emit | 测试 |
| 可测试性 | `structured-delta-identification.ts` 全部纯函数 | Vitest 单元测试 |

## Verification Map

| 约束 | Task | 测试文件 |
|---|---|---|
| Bash 直接形状 emit | tool-loop 重构 | tool-structured-delta-emission.test.ts |
| Bash 信封形状不回归 | tool-loop 重构 | tool-structured-delta-emission.test.ts |
| identifyStructuredDelta 直接/信封 | 模块单元测试 | structured-delta-identification.test.ts |
| tryEmitStructuredDelta emit/fallback/sensitive | 模块单元测试 | structured-delta-identification.test.ts |
| 白名单外工具不触发 | tool-loop 保留 | tool-structured-delta-emission.test.ts |
| 敏感内容不 emit | 共享安全检查 | 两个测试文件 |

## Risks / Trade-offs

- [信封误判] 低风险。信封解包后仍走 `isStructuredEvent` 枚举校验。
- [流式逐块性能] 低风险。每个 chunk 做一次 JSON.parse + 两次形状检测。
- [历史回放 gap] 已知 deferred。后续单独处理。
- [CLIP provider legacy 代码保留] 中风险。spec 标注 legacy。

## Open Questions

无。
