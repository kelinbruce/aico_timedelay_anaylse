## 背景与问题（Why）

pending input 不能无限等待。用户关闭页面、换设备、服务重启或上游无人处理时，runtime 必须能基于 durable facts 发现 timeout，提交 `TIMED_OUT` 事实，拒绝 late answer，并对原 run 产生安全、可观察的后续结果。

本 change 只定义进入 pending 后的 timeout 处理；它不决定什么上游会请求 pending，也不把 timeout behavior 写入 pending input 对象。

## 变更范围（What Changes）

- 定义 pending input timeout default、最大值和更短 `timeoutAt` 的接受规则。
- 明确 timeout rule 由本 change 定义，timeout decision 由 runtime 在 pending acceptance 时执行；producer 只能请求 explicit `timeoutAt`，不能决定 timeout policy。
- runtime 使用 gateway due query 发现已到期且仍 `PENDING` 的 pending input。
- timeout resolve 使用 CAS，将 pending input 从 `PENDING` 变为 `TIMED_OUT`。
- runtime 发布 `USER_INPUT_TIMEOUT`，safe payload 不包含 raw prompt、raw answer 或 timeout behavior。
- late answer 必须被拒绝。
- 所有 pending kind 的 timeout 都不得自动 approve。
- 本 change 不新增 timeout behavior 字段，不新增 run status，不定义 type-specific 触发条件。

## 架构约束下的修改说明

- 需要修改：只修改 runtime timeout/recovery loop、pending due fact query 消费、CAS timeout resolve、safe `USER_INPUT_TIMEOUT` projection tests，以及 timeout validation tests。
- 修改后的变化：pending input 不再依赖进程内 timer 才能超时；runtime 可在重启后从 durable pending facts 找到到期项并把仍为 `PENDING` 的 fact 推进到 `TIMED_OUT`。
- 影响：active pending 不会无限占用等待状态；late answer 会得到 safe timeout/conflict outcome；confirmation、authorization、question、handoff 分别消费 timeout 结果，但都不能把沉默当成同意或合成答案。
- 边界：runtime 是 timeout decision owner；gateway 只返回 due facts，不决定 timeout outcome；producer、model、channel 和 client 不能定义或覆盖 timeout policy；不新增 timeout behavior/autoApprove 字段；不新增外部 scheduler、public timeout API、可配置 timeout policy 或 `RunStatus`。

## Capability 影响（Capabilities）

### 新增 Capability

- `human-pending-input-timeout`：runtime-owned timeout discovery and resolution for pending input。

### 修改的 Capability

- `human-pending-input-core`：消费 timeout 作为 pending terminal child status。

## 影响范围（Impact）

- 依赖：`refine-ts-pending-input-contracts`、`add-ts-human-pending-input-core`。
- 影响 package：`agent-runtime` timeout/recovery loop、`PendingInputStoreGateway` adapters、stream projection、安全错误和 runtime tests。
- 协作 owner：Owner 2 Runtime、Owner 3 Core / Agent Loop、Owner 6/8 Gateway、Owner 1 Channel、Owner 11 Governance/Observability。
- 非目标：不支持自动 approve；不持久化 timeout behavior；不实现 external scheduler；不实现 per-agent、per-kind、per-tenant、client-provided、gateway-derived 或 model-provided timeout 配置；不释放 lane 的规则仍由 core/lane scheduling 保持。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/human-pending-input-timeout/spec.md`：新增 timeout 行为契约。
- `openspec/specs/human-pending-input-core/spec.md`：补充 timeout status 与 late answer 关系。
- `openspec/designs/architecture/runtime-boundaries.md`：补充 timeout discovery/resolution flow。
- `openspec/designs/modules/agent-runtime.md`、gateway 模块文档、channel projection 文档：补充职责和验证入口。
