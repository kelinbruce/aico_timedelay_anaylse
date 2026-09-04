# add-ts-safety-guardrails

规划入口：[roadmap-v2 扩展候选](../nextagent-ts-change-roadmap-v2.md)
所属分组：Gateway / Security
对应能力：F6 安全护栏对接
优先级：P1

状态：assumption-ready
类型：实施 change
主要 owner：`agent-channel-web`
协作 owner：`agent-core`
依赖：`add-ts-redaction-policy`、`add-ts-routing-constraint-validation`、`add-ts-risk-policy-enforcement`

目标：
- 安全护栏作为可配置 gateway port，支持 enable/disable。
- 输入检查点在 request acceptance 阶段运行，输出检查点在 model round 结束前运行。
- 对接外部安全检测 API（可插拔 adapter）。
- 检查结果仅记录 pass/reject + reason code 到 audit event。
- 输入和输出护栏可独立启用/禁用。

规格输入：
- 安全护栏 port 命名为 `SafetyGuardrailPort`，归 `agent-contracts/gateway`；输入护栏和输出护栏为同一 port 的两个检查点，不新增独立 port。
- `SafetyGuardrailConfig` 包含 `inputEnabled: boolean` 和 `outputEnabled: boolean`，两者独立配置；默认均为 `false`（deny-by-default）。
- 输入检查点在 request acceptance 阶段运行：检查用户输入文本（不含 attachment blob 内容），reject 时 request 不进入 scheduling，返回 safe error。
- 输出检查点在 model round 结束前运行：检查模型生成的 final answer 文本（不含 tool call arguments、reasoning/thinking），reject 时该 round 结果被丢弃，runtime 标记 safe error。
- 外部安全检测通过可插拔 `SafetyGuardrailAdapter` 对接；adapter 由 app composition 注册，不接受客户端配置的 endpoint 或 credential。
- 检查结果 `SafetyGuardrailResult` 仅包含 `outcome: pass | reject` 和 `reasonCode: string`；MUST NOT 包含 raw 检测内容、用户输入、模型输出或 provider response。
- audit event 至少包括 `guardrail.input.checked`、`guardrail.input.rejected`、`guardrail.output.checked`、`guardrail.output.rejected`。
- 护栏检查 MUST NOT 修改用户输入、模型输出、request run 状态或 capability invocation 结果；reject 只阻止后续流程，不改写已有事实。
- 护栏 adapter 调用 MUST 接收 `AbortSignal`，超时或取消时按 reject 处理（fail-closed）。
- 护栏配置来源为 app config，不得来自客户端请求体、模型输出或 capability 参数。

契约输入：
- `SafetyGuardrailPort`（`agent-contracts/gateway`）：新增 gateway logical port。
- `SafetyGuardrailConfig`（`agent-contracts/gateway`）：`inputEnabled`、`outputEnabled`。
- `SafetyGuardrailResult`（`agent-contracts/gateway`）：`outcome`、`reasonCode`。
- `SafetyGuardrailAdapter`（`agent-contracts/gateway`）：可插拔 adapter interface，由 app composition 注册。
- audit event（`agent-contracts/observability`）：guardrail check 事件。
- request acceptance flow（`agent-runtime`）：输入检查点接入位置。
- model round lifecycle（`agent-core`）：输出检查点接入位置。

实现约束：
- `agent-channel-web` 不直接调用外部安全 API，只通过 `SafetyGuardrailPort` 委托。
- `agent-core` 在 model round 结束前插入输出检查点，不改变 model invocation 契约。
- adapter 实现归 app composition 层，不得在 `agent-channel-web` 或 `agent-core` 内硬编码 endpoint。
- 护栏检查不绕过 redaction policy：传给 adapter 的内容必须经过 redaction。
- 护栏检查不替代 risk policy enforcement：risk policy 管控 capability 调用权限，护栏管控内容安全。

非目标：
- 不定义安全检测算法或规则（由外部 adapter 承载）。
- 不定义护栏的 bypass 或 whitelist 机制。
- 不定义 attachment 内容检测（首版只检测文本输入和文本输出）。
- 不定义护栏结果的用户可见反馈 UI（reject 统一返回 safe error）。
- 不改变 risk policy、redaction policy 或 routing constraint 的已有契约。

验收要点：
- contract test：`SafetyGuardrailPort`、`SafetyGuardrailConfig`、`SafetyGuardrailResult` 契约覆盖。
- security test：输入护栏 reject 时 request 不进入 scheduling；输出护栏 reject 时 round 结果被丢弃。
- security test：adapter 超时或取消时 fail-closed（reject）。
- security test：audit event 不包含 raw 输入/输出内容。
- architecture test：`agent-channel-web` 不直接依赖 adapter 实现。
- 验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。

并行边界：
- 不修改 `add-ts-redaction-policy`、`add-ts-risk-policy-enforcement`、`add-ts-routing-constraint-validation` 的已有契约。
- 不侵入 `agent-runtime` 的 request lifecycle 和 scheduling 语义（只在 acceptance 阶段插入检查点）。
- 不侵入 `agent-model` 的 provider adapter 契约。
- `add-ts-loop-limit-summary` 可并行推进，两者不耦合。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
- 标为 `assumption-ready` 的条目在 proposal 阶段需显式固化默认假设（adapter 超时阈值、fail-closed 策略）。
