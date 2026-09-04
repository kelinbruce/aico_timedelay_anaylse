## Why

上下文预算计算（`add-ts-context-budget-explainability`）需要"模型上下文窗口大小"作为 `availableInputUnits` 的输入：

```text
availableInputUnits = window - reservedOutput - 固定 prompt 槽位
```

但当前 model 契约里没有任何字段承载这个窗口大小：

- 冻结的 `agent-contracts/app.ModelProfile` 当前有 10 个字段：`profileId / providerKind / modelName / baseUrl / credentialRef / timeoutMs / modelOptions / providerOptions / enabled / fallbackEligible`。
- `ModelInfo` 只有 `baseUrl / credentialRef / modelName`。
- `ModelOptions.maxTokens` 是**输出**上限，不是上下文窗口。

窗口是模型固有容量事实，由 `providerKind + modelName` 唯一确定，不是 agent 作者的行为选择，也不能由客户端请求携带。它的天然 owner 是 model profile。本 change 在实现 change 消费前先把这个字段冻结一次。

## What Changes

- 在 `agent-contracts/app.ModelProfile` 增加 `contextWindowTokens: number`，表达模型上下文窗口容量（token 数）。
- 明确窗口是 context assembly 预算计算的 selected model window 来源，由 `assemble()` 从 accepted model profile 解析，不经 `ContextAssemblyRequest`、客户端请求体、模型输出或 capability 参数。
- 不改 `ModelInfo` / `ModelOptions`；`maxTokens` 仍只表达输出上限。

## Capabilities

- 新增 `model-profile-contracts` 作为 contract-refinement capability。
- 不实现 model invocation、selection、fallback、预算计算或 context assembly 行为。

## Impact

- `add-ts-context-budget-explainability` 消费本 change 冻结的 `ModelProfile.contextWindowTokens` 作为窗口来源，不自己定义窗口字段。
- `add-ts-model-provider-configuration` 拥有产品 model profile 基线与 `modelProfileRegistrySnapshot`。本 change 把 `contextWindowTokens` 冻结为 `ModelProfile` 的必填字段后，该 change 在实现期必须为产品 profile 提供该字段（类型层面强制，缺失则无法编译）；本 change 不直接改它的 spec、启动校验、快照或 selector 语义。其产品基线字段清单与本契约的对齐属于该 change 自身的实现期任务。

## Baseline Promotion Plan

实现并验证后，把契约提炼到：

- `openspec/specs/model-profile-contracts/spec.md`
- `openspec/designs/architecture/core-contracts.md`
