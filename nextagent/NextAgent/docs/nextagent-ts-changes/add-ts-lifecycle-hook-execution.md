# add-ts-lifecycle-hook-execution

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Policy Hooks

状态：active
类型：实施 change
主要 owner：`agent-runtime`
协作模块：`agent-core`、`agent-observability`
依赖：`establish-ts-core-contracts`、`ship-ts-minimal-agent-kernel`

目标：
- 支持 app-composed TypeScript lifecycle hook code、hook definition、Agent hook binding、按阶段顺序执行、超时、decision/mutation 处理、safe error 和 hook invocation event；配置只声明接入时机、顺序、超时和传给 hook code 的参数，并在启动期冻结。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 提供首版最小 lifecycle hook 执行机制，并与 risk policy enforcement 保持清晰边界。

共享规格输入：
- 首版纳入最小 lifecycle hook 执行机制，但复杂扩展后置。
- `add-ts-lifecycle-hook-execution` 支持 app-composed TypeScript lifecycle hook code、hook definition、Agent hook binding、按阶段顺序执行、超时、decision/mutation 处理、safe error 和 hook invocation event。
- hook code 由 `agent-app` composition 在启动期显式接入并冻结；首版 TypeScript hook implementation 源码归打包后运行根目录下与 `bin/`、`config/` 平级的 `hooks/`；配置只声明接入时机、顺序、超时和参数，不承载业务处理策略，runtime 不把 `config` 解释为脚本、表达式、远端调用、模型指令或策略 DSL。
- 首版 hook code 只支持 TypeScript 后端编译产物，不支持 Python、Java、shell、Wasm、远端、脚本文件或模型生成代码作为 lifecycle hook implementation。
- hook definition 和 Agent binding 必须分离；definition 包含 `kind`，取值为 `SYSTEM`、`CUSTOM`。
- binding 可以覆盖 `stages`、`order`、`timeoutMs` 和 `config`，不得修改 `kind`、`executionMode`、`failureMode`、`source` 或 hook 支持边界。
- `SYSTEM` hook 早于 `CUSTOM` hook 执行，不得被 Agent binding 禁用，且 `failureMode` 必须为 `FAIL`；同 kind 内按 `order`、再按 `hookId` 稳定排序。
- `HookFailureMode` 只包含 `CONTINUE` 和 `FAIL`，只处理 hook 自身超时、异常、不可用或返回非法结果。
- `CONTINUE` 表示记录 `HookInvocationEvent(status=TIMEOUT|FAILED)` 后主流程继续；`FAIL` 表示记录事件后按请求失败路径终止。
- hook 正常返回的 `REJECT`、`PEND` 是控制决策，不受 `failureMode` 控制。
- stage 使用核心契约冻结的 `BEFORE_REQUEST_ACCEPT`、`BEFORE_PLANNING`、`BEFORE_MODEL_INVOKE`、`AFTER_MODEL_RESULT`、`BEFORE_CAPABILITY_INVOKE`、`AFTER_CAPABILITY_RESULT`、`BEFORE_CONTEXT_COMPACT`、`AFTER_CONTEXT_COMPACT`、`BEFORE_TERMINAL_EVENT`。
- hook input 只包含 `hookId`、`bindingId?`、`agentId`、`agentVersion`、`stage`、`boundary`、`config?`。
- hook result 只表达 runtime 必须处理的 `decision?`、`pendingInputIntent?`、`mutation?`、`safeReason?`、`error?`。
- 核心契约中的 `HookBoundary` 和 `BoundaryMutation` 只是统一基类语义，不携带 `stage`、`payload` 或 `patch` 字段；本 change 定义每个 stage 的具体 typed boundary/mutation。
- Stage-specific boundary/mutation 归 `agent-contracts/runtime`；首版只定义最小清单，不新增 `agent-contracts/hook`、通用 `PolicyPort` 或跨 owner hook contract。
- `mutation` 缺省代表 no-op，不定义 `NoopMutation`。
- `HookDecision` 使用 `NO_OPINION`、`APPROVE`、`REJECT`、`PEND`；`NO_OPINION` 和 `APPROVE` 继续流程，`REJECT` 终止流程，`PEND` 挂起并由 runtime 创建 pending input。
- `REJECT` 或 `PEND` 与 mutation 同时出现时，runtime 以控制信号为准，不应用 mutation。
- hook 观察行为由 hook 自己完成，不通过返回值要求 runtime 代做观察。
- runtime 必须校验 mutation 与当前 stage boundary 匹配后才能应用；effective boundary 由 runtime 产生。
- `BLOCKING` hook 同步顺序执行并顺序归约；首版不支持会影响流程的并行 hook，也不定义并行 mutation 或 decision 合并规则。
- `NON_BLOCKING` hook 只能观察，不得返回 decision 或 mutation；若返回，runtime 记录诊断并忽略这些控制结果和修改请求。
- 每次 hook 执行必须产生 `HookInvocationEvent`，记录 requestRunId、sessionId、rootMessageId、agentId、agentVersion、hookId、bindingId?、stage、status、时间、decision、safe reason/error 和 mutation summary。
- `HookInvocationEvent` 是结构化观测事件，不是核心业务持久化对象；首版必须通过 hook executor observed wrapper 输出结构化日志和 hook 指标，可以发送到 audit writer，但不提供 hook invocation 查询 API。
- `HookInvocationEvent` 不是 canonical timeline event；每次 hook invocation 不默认写入 timeline。
- hook 指标至少覆盖 invocation count by hookId/stage/status、latency by hookId/stage、timeout/failure count。
- 只有 hook decision 改变 request lifecycle 时才写入 timeline-only `HOOK_DECISION_APPLIED`，例如 `REJECT` 导致请求失败，或 `PEND` 触发 pending input；首版不新增对应 `StreamEventType`。
- `mutationSummary` 由 runtime 生成：无 mutation 时不填；有 mutation 时只记录具体 mutation 类型或稳定 mutation kind 和被修改字段名，不记录字段值、完整 boundary、完整 mutation、hook input/result、模型消息、工具参数、工具结果、附件内容或 secret。
- 通用 `PolicyPort` 不进入核心契约；risk policy 使用 `add-ts-risk-policy-enforcement` 自身接口。
- 首版不开放插件热加载、远端 hook 或脚本 hook；hook code 只能通过 app composition 接入，且启动完成后 request 执行使用冻结的 hook code/definition/binding 快照；runtime 不扫描目录、不按配置路径动态 import，也不从 Agent package 目录加载 hook code。
- Policy/hook 不拥有 RequestRun、checkpoint、terminal commit 或 channel state。

并行边界：
- 首版 hook 只支持 app-composed TypeScript code 接入路径，不提供开放式 hook 插件生态。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
