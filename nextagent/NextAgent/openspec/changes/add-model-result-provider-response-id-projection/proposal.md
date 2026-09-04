## Why

模型网关在响应中返回的 `providerResponseId` 是一次模型调用的安全 response correlation 标识。`model-invocation-contract` 已将 `providerResponseId` 定义为 `ModelFinalResult` 的合法 optional field，明确其 只用于安全 response correlation。然而 `lifecycle-hook-execution` 规格中 `AFTER_MODEL_RESULT` boundary 的投影规则只覆盖 `modelE2ELatencyMs`、`firstContentLatencyMs`、`usage`、`content`、`reasoning` 和 `toolCalls`，没有将 `providerResponseId` 列为 boundary 可投影字段。

结果是：即使 provider 已返回 response ID 并经 normalization 进入 `ModelFinalResult.providerResponseId`，该字段也无法到达 `AFTER_MODEL_RESULT` 阶段的 hook boundary，observe-only 诊断 hook（如 `developer-hook-trace`）在 `AFTER_MODEL_RESULT` 阶段无法获取模型返回的 response ID 进行 response correlation。流式路径由于此前未捕获 `data.id`，问题更为明显。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 成功 `ModelFinalResult` 携带 `providerResponseId` 时，`AFTER_MODEL_RESULT` boundary MUST 投影同一 `providerResponseId` 值；未携带时 boundary MUST 省略该字段。
- `providerResponseId` 在 boundary 上是 observe-only fact，MUST NOT 成为 mutation field；hook 对该字段返回的任何修改 MUST NOT 改变模型结果。
- 流式与非流式两条 normalization 路径都 MUST 将 provider 返回的 response ID 收敛到 `ModelFinalResult.providerResponseId`，使 boundary 投影在两种调用模式下行为一致。

**非目标：**

- 不改变 `ModelFinalResult.providerResponseId` 的定义、语义或 trusted source——该字段仍由 `model-invocation-contract` 规定。
- 不改变 `AFTER_MODEL_RESULT` mutation 的封闭字段集；`providerResponseId` 不加入 mutation fields。
- 不改变 boundary 的封闭对象约束或 unknown-field fail-closed 语义。
- 不改变 `providerResponseId` 的安全 classification——它只用于安全 response correlation，MUST NOT 进入 Web API、SSE、WebSocket、timeline、SafeError、audit、metric、trace 或 `ObservabilityObservationEvent`。

## What Changes

- 修改 `lifecycle-hook-execution` spec 中 `Stage-specific boundaries and mutations are minimal runtime contracts` Requirement：在 `AFTER_MODEL_RESULT` boundary 的投影规则中新增 `providerResponseId` 投影规则——成功 `ModelFinalResult` 携带 `providerResponseId` 时 boundary MUST 投影该值，未携带时 MUST 省略；该字段为 observe-only，不得成为 mutation field。
- 不新增、不移除任何 Function 或 Feature。
- 不新增 public API surface 或新的 contract export；`providerResponseId` 已由 `ModelFinalResult` 定义，本次只是将其投影到已有 boundary。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.1 注册和执行钩子` → `specs/lifecycle-hook-execution/spec.md`
  - 功能边界：`AFTER_MODEL_RESULT` boundary 新增 `providerResponseId` 作为 observe-only 投影字段，使诊断 hook 可获取模型返回的 response ID 进行安全 response correlation。
  - 系统质量属性：可维护性、可测试性、审计/可追溯性
  - 映射说明：canonical spec

## 影响范围（Impact）

- `agent-contracts`：`ModelResultBoundary` interface 新增 `providerResponseId?: string` optional 字段，与 `ModelFinalResult.providerResponseId` 对齐。
- `agent-model`：`lifecycle-hook-wrapper` 在构造 `AFTER_MODEL_RESULT` boundary 时投影 `result.providerResponseId`。
- `agent-platform-gateway-remote`：流式 path 已在 gateway-provider 中捕获 `data.id` 并返回 `providerResponseId`（本 change 不覆盖该文件改动，假定其已独立完成）。
- 现有 observe-only 诊断 hook（如 `developer-hook-trace`）可在 `AFTER_MODEL_RESULT` 阶段读取 `boundary.providerResponseId`。
- 不影响 Web API、SSE、WebSocket、timeline、audit、metric、trace 等 public surface；`providerResponseId` 不出现在这些边界。
