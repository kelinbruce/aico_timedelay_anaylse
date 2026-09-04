# add-ts-agent-routing-core

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Agent Routing

状态：ready
类型：实施 change
主要 owner：`agent-core`
依赖：`ship-ts-minimal-agent-kernel`

目标：
- 在 Agent 接口之后建立 routing policy，runtime 不做业务语义路由。
- 为后续特定 routing 分支（如 workflow recipe dispatch）提供唯一 routing policy 主入口和 owner 边界。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 保证请求路由位于 Agent 内部，并支持确定性处理、模型驱动回退、定向技能和可解释路由证据。

共享规格输入：
- routing evidence 首批进入审计和日志/trace，不作为用户可见信息。
- 审计记录 routing decision fact，包括候选、选中路径、回退原因和 policy outcome，但不包含 raw prompt。
- 用户侧只看到最终状态或 safe error，不暴露详细路由证据。
- routing constraints 首批支持 `preferredSkillId`、`forbiddenCapabilityIds`、`executionMode`、`locale`、`maxToolCalls`、`allowHumanInput`、`allowSubagents`。
- 不支持用户直接传入 owner、tenant、capability provider override 或 raw system prompt。
- 所有 constraints 必须由 Agent routing policy 校验，不能绕过 capability governance。
- workflow recipe dispatch 如启用，只能作为 agent-core routing policy 下的受控分支，不得形成第二套独立业务路由主入口。
- recipeName 显式命中、workflow intent match 等 workflow 特定判断，必须挂接在 agent-core routing policy 内消费，而不是绕过通用 routing owner。

并行边界：
- 业务路由只属于 `agent-core` 内部 Agent policy。
- channel 和 runtime 只能传递约束，不能直接选择业务处理路径。
- `add-ts-workflow-routing` 只承接 workflow 相关 routing 分支，不重定义通用 routing policy owner。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
