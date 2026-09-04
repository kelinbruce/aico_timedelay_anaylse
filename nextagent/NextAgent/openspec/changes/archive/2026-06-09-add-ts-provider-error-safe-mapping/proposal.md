## 背景与问题（Why）

模型访问失败需要统一的安全失败边界。当前最关键的问题是：

- provider/model failure 形状不稳定
- raw provider error 可能含敏感信息
- sync、stream、normalization 失败容易分成多套出口

这个 change 的目标是定义 provider/model failure 如何映射进统一的 error code/category/retryable 语义、`SafeError` 输出和 `ErrorNormalizer` 体系。

## 变更范围（What Changes）

- 将 change 改为 provider/model failure 到标准 error code/category/retryable 语义和 `SafeError` 的映射规则。
- 明确 sync、stream、normalization failure 都使用同一安全错误边界。
- 明确 raw provider error、raw credential、stack trace、transport internals 不得越过边界。
- 明确 fallback 只能消费安全错误和稳定错误分类，而不是原始 provider exception。

## 独立 Change 理由（Why Separate）

本 change 不合并进 `add-ts-model-invocation-contract`，因为它定义的不是模型调用失败终态本身，而是 provider/model failure 跨边界前的安全归一化规则。它拥有独立可验证的安全行为：provider failure 分类、unknown error normalization、raw provider detail 脱敏、`SafeError` 映射、stream / normalization failure 统一收口，以及 fallback / observability 只能消费安全错误。

`add-ts-model-invocation-contract` 只定义模型调用生命周期、调用前置条件、`complete()` / `stream()` 的统一终态关系，以及失败终态通过 `ModelFinalResult.safeError` 暴露。它不展开 provider error taxonomy、脱敏规则、unknown exception normalization、raw provider body 裁剪或 observability / fallback 的安全消费规则。

因此，本 change 需要保留为独立 change，并通过直接相关的 agent-model provider tests 验证 provider timeout、provider unavailable、malformed stream、normalization failure、unknown exception 和 raw provider sensitive detail 不越界等场景。

## 相邻 Change 关系（Adjacent Change Relationship）

`add-ts-model-invocation-contract` 定义失败出口：模型调用失败时，终态通过 `ModelFinalResult.safeError` 表达，并且 provider adapter 不得把 raw provider failure 直接暴露给上层。它负责说明 provider-native failure 会进入 safe mapping boundary，但不定义 safe mapping 的分类、脱敏和跨边界输出规则。

本 change 定义 safe mapping boundary：provider invocation failure、stream failure、normalization failure 和 unknown exception 如何归入标准 error code/category/retryable 语义，再通过 `ErrorNormalizer.normalize(error)` 或等价安全路径生成 `SafeError`。它负责规定 `SafeError` 中不得包含 raw provider body、raw credential、stack trace、local path、transport internals，并规定 fallback / observability 只能消费 `SafeError` 的稳定字段。

本 change 不重新定义 `ModelInvocationRequest`、模型调用触发时机、`complete()` / `stream()` 生命周期或 `ModelFinalResult` 的整体终态契约；不定义 fallback policy 或 observability pipeline 实现，只定义它们可消费的安全错误边界。

## Capability 影响（Capabilities）

### 修改的 Capability
- `model-invocation-contract`: 失败终态通过 `ModelFinalResult.safeError` 暴露。
- `provider-error-safe-mapping`: 澄清 provider/model failure 到标准错误语义和 `SafeError` 的映射规则。

## 影响范围（Impact）

- 受影响模块：
  - `modules/agent-model`
  - `modules/agent-core`
  - `packages/agent-model/tests`

## 归档前基线提升计划（Baseline Promotion Plan）

行为契约：
- `openspec/specs/provider-error-safe-mapping/spec.md`：新增

设计视图：
- `openspec/designs/modules/agent-model.md`
- `openspec/designs/architecture/observability-and-diagnostics.md`
- `openspec/designs/spec-to-design-map.md`

验证入口：
- agent-model provider tests covering timeout, unavailable response, malformed stream, normalization failure, unknown exception, and raw detail redaction
