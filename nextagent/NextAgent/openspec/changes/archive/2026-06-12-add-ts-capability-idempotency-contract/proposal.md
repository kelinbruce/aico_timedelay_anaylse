## 背景与问题（Why）

NextAgent 的 capability 执行可能触发外部系统调用、网络配置查询、诊断命令、工单写入或客户系统变更。runtime retry 和 runtime recovery 在某些场景下需要重新调用同一个 Tool；如果 Tool 是否支持重放没有统一契约，系统就无法判断重复调用是否安全。

`establish-ts-core-contracts` 已经把 `CapabilityReplayPolicy` 定义为跨 runtime、assembly、capability 和 recovery 共享的基础 enum，并把 `CapabilityInvocationRequest.idempotencyKey?` 放入统一 capability invocation contract。目标态不得引入 `isIdempotent`、`IdempotencyDeclaration`、validator cache 或其他与 core contracts 和 `add-ts-runtime-recovery-idempotency-guard` 竞争的并行契约。

本 change 收敛 Tool 幂等声明的最小契约：capability descriptor 通过 `CapabilityReplayPolicy` 明确是否允许恢复/重试重放；runtime 在允许重放时通过稳定 `idempotencyKey` 调用 capability；Tool/provider 对同一 key 的重复调用语义负责。默认值必须是 `NON_IDEMPOTENT`。

## 变更范围（What Changes）

- 定义 capability descriptor / assembly 暴露 `CapabilityReplayPolicy`，取值为 `NON_IDEMPOTENT` 或 `IDEMPOTENT`。
- 定义 Tool 默认 `NON_IDEMPOTENT`；只有显式声明 `IDEMPOTENT` 的 Tool 才可被 runtime recovery 或 retry 使用稳定 `idempotencyKey` 重新调用。
- 定义 `CapabilityInvocationRequest.idempotencyKey?` 的使用边界：runtime 在恢复/重试等需要重复调用且 replay policy 允许时提供稳定 key；普通首次调用可不携带 key。
- 定义支持 `IDEMPOTENT` 的 Tool/provider 必须在同一稳定 key 下保持重复调用语义，不得因重复调用产生第二次不可逆 side effect。
- 定义安全边界：`idempotencyKey` 原文不得进入日志、trace、audit、stream、safe error 或 provider metadata。
- 不引入 `isIdempotent`、`IdempotencyDeclaration`、`IdempotencyScope`、`IdempotencyHandling`、`IdempotencyValidator`、全局 duplicate cache 和缓存返回策略等并行契约。
- 不定义跨 session/global 幂等、不定义 provider 存储实现、不定义重复调用结果缓存系统、不新增独立 error enum。

## Capability 影响（Capabilities）

### 新增 Capability

- `idempotency-contract`: 定义 capability replay policy、稳定 idempotency key 使用边界、默认非幂等、安全脱敏和 runtime/capability 职责分工。

### 修改的 Capability

- 无。该 change 以新增 `idempotency-contract` capability 承载幂等声明行为；不修改已有 stable spec requirement。

## 影响范围（Impact）

- `agent-common`：承载 `CapabilityReplayPolicy` 和 `IdempotencyKey` 基础类型，供 runtime、capability、assembly、recovery 和 observability 复用。
- `agent-contracts/capability`：`CapabilityInvocationRequest` 保留可选 `idempotencyKey`，不新增 `recoveryReplay` 或 workspace 字段。
- `agent-capability` / provider：descriptor/assembly 暴露 replay policy；provider 对 `IDEMPOTENT` capability 的重复调用语义负责。
- `agent-runtime`：在 retry/recovery 决策中读取 replay policy，并在允许重放时生成或传递稳定 idempotency key；不实现通用 duplicate cache。
- `agent-observability`：对 idempotency key 原文执行脱敏，诊断只记录 hash/truncated/stable correlation 或错误码。
- 测试：覆盖默认非幂等、显式 `IDEMPOTENT`、invocation request key 传递、非幂等不可重放、key 脱敏和 cross-change guard 对齐。

## 主要 Owner

- `agent-capability`、`agent-runtime`

## 归档前更新基线（Baseline Promotion Plan）

行为契约：

- `openspec/specs/idempotency-contract/spec.md`：新增 capability replay policy、stable idempotency key、默认非幂等、provider 责任和 redaction 的行为契约。

长期背景：

- `openspec/overview.md`：补充 side-effect idempotency 对电信网络智能体恢复和重试安全的意义。

设计视图：

- `openspec/designs/contracts/core-contracts.md`：提炼 `CapabilityReplayPolicy`、`CapabilityInvocationRequest.idempotencyKey?` 和“不使用 `isIdempotent`”的契约结论。
- `openspec/designs/modules/agent-capability.md`：提炼 descriptor replay policy 暴露职责和 provider 重复调用语义。
- `openspec/designs/modules/agent-runtime.md`：提炼 runtime 只消费 replay policy 并生成/传递 stable key，不拥有 provider 幂等实现。
- `openspec/designs/adr/capability-replay-policy.md`：记录选择 enum policy 而不是 boolean `isIdempotent` 或独立 declaration object 的取舍。
- `openspec/designs/spec-to-design-map.md`：新增 `idempotency-contract` 的长期导航。

验证入口：

- Capability descriptor contract tests。
- Capability invocation request schema tests。
- Runtime recovery/retry replay policy integration tests。
- SafeError/redaction tests。
- Cross-change review with `add-ts-runtime-recovery-idempotency-guard`。
- `openspec validate add-ts-capability-idempotency-contract --strict`。
