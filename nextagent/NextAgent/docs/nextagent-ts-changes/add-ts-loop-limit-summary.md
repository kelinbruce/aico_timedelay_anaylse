# add-ts-loop-limit-summary

规划入口：[roadmap-v2 扩展候选](../nextagent-ts-change-roadmap-v2.md)
所属分组：Runtime / Request Control
对应能力：F4 Loop 上限总结输出
优先级：P1

状态：assumption-ready
类型：实施 change
主要 owner：`agent-runtime`
协作 owner：`agent-core`
依赖：`add-ts-capability-core-governance`、`ship-ts-minimal-agent-kernel`

目标：
- `AgenticLoop` 支持 `maxDurationMs` 与 `maxIterations` 上限声明。
- 达到任一上限后 loop 标记 `LIMIT_REACHED`，禁止后续 capability 调用，允许一次 finalization model round。
- 若 finalization round 也失败则返回安全失败结果。
- 上限继承 `AbortSignal` / cancellation 链条，不引入独立的超时机制。

规格输入：
- `maxDurationMs` 基于 deadline clock，从 request acceptance 时开始计算；`maxIterations` 基于 tool call batch 计数（一次 model round 内的并行 tool call 算一个 iteration）。
- 达到 `maxDurationMs` 或 `maxIterations` 后，runtime MUST 将 loop 状态标记为 `LIMIT_REACHED`，MUST NOT 发起新的 capability invocation。
- `LIMIT_REACHED` 状态下 runtime SHALL 允许且仅允许一次 finalization model round：该 round 不携带 tool definitions，模型只能输出总结性 final answer。
- 若 finalization round 因 model error、timeout 或 cancellation 失败，runtime MUST 返回 safe error，不得重试 finalization。
- `maxDurationMs` 和 `maxIterations` 的来源为 `AgentRuntimeSettings`（已有 `maxToolIterations?` 字段）和 app config；不得来自客户端请求体、模型输出或 capability 参数。
- deadline 到达时若有进行中的 capability invocation，runtime MUST 通过 `AbortSignal` 取消，取消语义与 `add-ts-request-cancel` 一致。
- `LIMIT_REACHED` MUST 在 timeline 中产生可观测事件，stream 中向客户端投影为 RunStatus 变化。
- 本 change 不与 `add-ts-output-continuation-flow`（输出过长不截断）混淆：后者解决输出长度，本 change 解决 loop 生命周期上限。

契约输入：
- `AgentRuntimeSettings`（`agent-contracts/core`）：已有 `maxToolIterations?`，新增 `maxDurationMs?`。
- `RequestRun` status：新增 `LIMIT_REACHED` 状态值（或等价 lifecycle marker），归 `agent-contracts/runtime`。
- `RunStatus`（`agent-contracts/runtime`）：需覆盖 `LIMIT_REACHED` 在 stream 中的投影。
- `AbortSignal` / cancellation context：复用 `add-ts-request-cancel` 的 cancellation 链条，不新增独立 timeout port。
- Timeline event：`LIMIT_REACHED` 事件归 runtime canonical timeline。

实现约束：
- `agent-runtime` 拥有 loop 上限检测、`LIMIT_REACHED` 状态推进和 finalization round 编排。
- `agent-core` 负责在 `LIMIT_REACHED` 状态下移除 tool definitions 并构造 finalization model invocation。
- deadline clock MUST 在 request acceptance 时启动，不得在 model round 或 capability execution 阶段延迟启动。
- finalization round 的 model invocation MUST 携带安全 prompt（告知模型已达上限需总结），prompt 内容不得包含 raw capability result 或敏感数据。
- `maxDurationMs` 和 `maxIterations` 的默认值由 app config 提供；未配置时不设上限。

非目标：
- 不定义 output continuation / 输出截断行为（由 `add-ts-output-continuation-flow` 承载）。
- 不定义 capability-level timeout 或 per-tool duration limit（由 capability invocation timeout 承载）。
- 不定义 loop retry 或自动恢复机制。
- 不改变 `AbortSignal` 的已有 cancellation 语义。

验收要点：
- contract test：`LIMIT_REACHED` 状态在 `RequestRun` 和 `RunStatus` 中的覆盖。
- characterization test：达到 `maxIterations` 后不再发起 capability invocation，finalization round 无 tool definitions。
- characterization test：达到 `maxDurationMs` 后进行中 capability 被 cancel，取消语义与 request-cancel 一致。
- resilience test：finalization round 失败时返回 safe error，不重试。
- 验证：`npm run build`、`npm test`、`npm run test:contract`。

并行边界：
- 不修改 `agent-contracts/core` 冻结契约（`AgentRuntimeSettings` 新增可选字段 `maxDurationMs?` 不破坏现有契约）。
- 不侵入 `agent-capability` 的 invocation boundary。
- 不侵入 `agent-model` 的 provider adapter 契约。
- `add-ts-output-continuation-flow` 可并行推进，两者不耦合。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
- 标为 `assumption-ready` 的条目在 proposal 阶段需显式固化默认假设（`maxDurationMs` / `maxIterations` 默认值和单位）。
