# add-ts-capability-idempotency-contract

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Capability

状态：active
类型：实施 change
主要 owner：`agent-capability`、`agent-runtime`
依赖：`add-ts-capability-core-governance`

目标：
- 定义 Tool 幂等重放声明契约；只有显式声明 `CapabilityReplayPolicy=IDEMPOTENT` 的 Tool 才可在恢复或重试时使用稳定 `idempotencyKey` 重新调用。
- Tool 默认 `CapabilityReplayPolicy=NON_IDEMPOTENT`。
- `CapabilityInvocationRequest` 保留可选 `idempotencyKey`；恢复重放资格由 runtime 在调用 capability 前判断。
- 本 change 不使用 `isIdempotent` 布尔字段，不定义 `IdempotencyDeclaration`、通用 duplicate cache、RETURN_CACHED 策略或跨 session/global 幂等存储。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 以统一 capability 语义支持 Tool、Skill 和 Agent capability 的发现、启停、冲突处理、调用和审计。
- 公共 capability kind 使用 `TOOL`、`SKILL`、`AGENT`。
- `CapabilityProviderKind`、`CapabilityReplayPolicy` 和 `CapabilityInvocationStatus` 归 `agent-common`。
- Capability descriptor 使用 `CapabilityProvider` 表达 provider 实例，字段为 `providerId`、`providerKind`、`providerType?`。
- Capability descriptor 暴露 `replayPolicy: CapabilityReplayPolicy`；缺省为 `NON_IDEMPOTENT`。
- `CapabilityInvocationRequest` 使用统一 capability 执行请求，字段为 `invocationId`、`capabilityId`、`toolCallId?`、`arguments`、`sessionId`、`requestId`、`runId`、`requestContextId`、`stepId`、`identityContext`、`agentId`、`agentVersion`、`timeoutMs`、`idempotencyKey?`。
- `CapabilityInvocationRequest` 不包含 `workspaceDir` 或 `recoveryReplay`；workspace/sandbox/provider 执行环境由 capability/provider 模块解析，恢复重放资格由 runtime 在调用前判断。
- `idempotencyKey` 原文不得进入日志、trace、audit、stream、safe error 或 provider metadata。

并行边界：
- `add-ts-capability-core-governance` 是该能力组的前置 change。
- `add-ts-runtime-recovery-idempotency-guard` 消费本 change 定义的 `CapabilityReplayPolicy` 和 stable `idempotencyKey`，不得重新定义 Tool 幂等声明。
- 各 provider/source change 不得创建第二套 catalog、discovery、invocation 或 replay policy 语义。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
