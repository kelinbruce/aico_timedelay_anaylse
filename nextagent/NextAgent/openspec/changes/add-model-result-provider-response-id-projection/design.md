## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.1 注册和执行钩子` | `AFTER_MODEL_RESULT` boundary 新增 `providerResponseId` 作为 observe-only 投影字段，使诊断 hook 可获取模型返回的 response ID 进行安全 response correlation | `lifecycle-hook-execution` | `FN-10.1 注册和执行钩子` |

## `FN-10.1 注册和执行钩子`

### 目标与规范依据

proposal 目标：成功 `ModelFinalResult` 携带 `providerResponseId` 时，`AFTER_MODEL_RESULT` boundary MUST 投影该值；未携带时省略。该字段为 observe-only，不得成为 mutation field。流式与非流式两条路径都须收敛到 `ModelFinalResult.providerResponseId`。

设计约束：`providerResponseId` 的定义、语义和 trusted source 由 `model-invocation-contract` 规定，本 change 不改变其定义，只将其投影到已有 boundary。

#### 本 Function 的目标 Requirements

canonical spec：`lifecycle-hook-execution`

- `MODIFIED`：`Stage-specific boundaries and mutations are minimal runtime contracts`

### 当前实现

- `agent-contracts/src/runtime/index.ts` 中 `ModelResultBoundary` interface 包含 `stepId`、`modelId`、`toolCallCount`、`safeAssistantOutputSummary`、`firstContentLatencyMs`、`modelE2ELatencyMs`、`usage`、`content`、`reasoning`、`toolCalls` 字段，无 `providerResponseId` 字段。
- `agent-model/src/invocation/lifecycle-hook-wrapper.ts` 中 `invokeAfterModelHook` 函数构造 `AFTER_MODEL_RESULT` boundary 时，投影了 `content`、`reasoning`、`toolCalls`、`usage`、`firstContentLatencyMs`、`modelE2ELatencyMs`，未投影 `providerResponseId`。
- `ModelFinalResult` 已定义 `providerResponseId?: string` 为合法 optional field，非流式 `normalizeResponse` 已返回该字段，流式 `handleStreamResponse` 已独立完成 `data.id` 捕获。
- `agent-model/tests/lifecycle-hook-wrapper.test.ts` 未断言 `providerResponseId` 的 boundary 投影行为。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| boundary MUST 投影 `providerResponseId` | `ModelResultBoundary` 无 `providerResponseId` 字段定义 | 需新增 optional 字段 |
| boundary MUST 投影 `providerResponseId` | `lifecycle-hook-wrapper` 构造 boundary 时未投影 `result.providerResponseId` | 需在 boundary 构造中新增条件投影 |
| boundary MUST 省略未携带的 `providerResponseId` | 无现有逻辑处理此字段 | 条件投影 `undefined` 时省略，与现有 `usage`/`reasoning`/`toolCalls` pattern 一致 |
| `providerResponseId` 为 observe-only，不得成为 mutation field | `ModelResultMutation` 未包含该字段，mutation 封闭字段表未列入 | 无 GAP，保持不变即可 |

### 修改方案

1. `agent-contracts/src/runtime/index.ts`：在 `ModelResultBoundary` interface 末尾（`toolCalls` 之后）新增 `readonly providerResponseId?: string;`。该字段为 optional，与 `ModelFinalResult.providerResponseId` 类型对齐。
2. `agent-model/src/invocation/lifecycle-hook-wrapper.ts`：在 `invokeAfterModelHook` 的 `createReadonlyHookView` 调用中，`toolCalls` 投影之后新增 `...(result.providerResponseId === undefined ? {} : { providerResponseId: result.providerResponseId })`，复用现有 conditional spread pattern。
3. 不修改 `ModelResultMutation`——`providerResponseId` 不加入 mutation fields，mutation 封闭字段表保持不变。
4. 不修改流式/非流式 normalization 路径——`gateway-provider` 的 `data.id` 捕获已独立完成，本 change 只覆盖 boundary 投影层。

owner：`agent-contracts` 负责 `ModelResultBoundary` 类型定义；`agent-model` 负责 `lifecycle-hook-wrapper` 的 boundary 构造。

失败路径：当 `result.safeError !== undefined` 时，`invokeAfterModelHook` 在入口直接返回 `result`，不构造 boundary，`providerResponseId` 不会被投影——这与现有 `modelE2ELatencyMs`、`usage` 等字段的行为一致。

验证关注点：boundary 投影正确性（携带时投影、未携带时省略）；observe-only 约束（不进入 mutation fields）；失败路径不投影。

#### 质量属性影响

无新增黑盒质量目标。`providerResponseId` 只用于安全 response correlation，不影响安全、性能、可靠性等系统质量属性的可验证契约。

## 验证策略（Verification Strategy）

- spec 行为 携带时投影和未携带时省略：由 `agent-model` 的 lifecycle-hook-wrapper unit test 覆盖，断言 boundary 上 `providerResponseId` 的存在与缺失。
- spec 行为失败路径不投影：由现有模型调用失败场景覆盖，确认 `safeError` 路径不构造 boundary。
- observe-only 约束（不得成为 mutation field）：由 architecture/contract test 断言 `ModelResultMutation` 不包含 `providerResponseId` 字段。
- `providerResponseId` 不进入 mutation 封闭字段表：由现有 Model hook mutation 遵守封闭 schema 场景间接覆盖——未知 mutation 字段 MUST 被拒绝。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/lifecycle-hook-execution/spec.md`：修改——将 `providerResponseId` 投影规则合并到 `Stage-specific boundaries and mutations are minimal runtime contracts` Requirement 中，并在 `modelE2ELatencyMs`、`firstContentLatencyMs` 和 `usage` 的 observe-only 列表中加入 `providerResponseId`。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.1-注册和执行钩子.md`：修改——更新 `AFTER_MODEL_RESULT` 诊断事实规格行，补充 `providerResponseId` 投影规则。
- `openspec/designs/features/`：无。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/`：无。
- `openspec/designs/modules/`：无。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：无。

## 风险与取舍（Risks / Trade-offs）

- `providerResponseId` 只投影到 hook boundary，不进入 Web API、SSE、WebSocket、timeline、SafeError、audit、metric、trace 或 `ObservabilityObservationEvent`。该约束由 spec 规定，不依赖运行时 configuration 关闭。
- 流式路径的 `data.id` 捕获依赖 `gateway-provider` 已独立完成的改动；若该改动未部署到运行环境，流式路径的 boundary 仍会省略 `providerResponseId`（非流式路径不受影响）。

## 待确认问题（Open Questions）

无。
