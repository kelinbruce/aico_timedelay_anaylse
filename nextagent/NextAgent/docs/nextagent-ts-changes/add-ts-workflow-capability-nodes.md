## add-ts-workflow-capability-nodes

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：P3 — Workflow 执行范式

状态：candidate
类型：实施 change
主要 owner：`agent-workflow`
依赖：`add-ts-workflow-execution-engine`、`add-ts-capability-core-governance`

目标：
- 实现能力调用节点：`tool-choice`、`restful`、`python`、`agent`（`tool` 节点首版暂不实现，保留设计规格）。
- 所有节点通过 `CapabilityInvocationService` 或对应 gateway port 调用，复用统一 `CapabilityInvocationRequest/Result` 契约。
- 本 change 定义能力节点私有配置和私有输出语义，但不反向扩大 workflow 最小 contract。

规格输入：

节点私有约束：

- workflow 最小 contract 只冻结节点共用字段；本 change 承接 capability 节点私有配置、输入映射、输出映射和运行时校验。
- 本 change 可以在节点私有 schema 中使用 `nodeConfig`、`structuredPayload` 等命名，但这些命名不得被提升为 workflow 最小 contract 的公共字段。
- 若需要新增跨节点共享的稳定 capability workflow 字段，必须先提出 contract refinement change。

**tool**（首版暂不实现）

- 通过 `CapabilityInvocationService` 调用指定 tool capability。
- `nodeConfig`：`capabilityId`、`arguments`（可引用上游变量）。
- 调用结果直接存入 `WorkflowNodeResult.structuredPayload`。

**tool-choice**

- 输入：`taskDescription` + `candidateTools`（tool capabilityId + description 列表）。
- LLM（通过 `ModelInvocationService`）从候选集中选择最合适的 tool。
- 输出：`selectedToolId`。
- 不执行 tool 本身，选择结果供下游 `tool` 节点使用。

**restful**

- 通过 gateway 发起 HTTP 请求。
- `nodeConfig`：`method`、`url`、`headers`、`body`、`timeoutMs`。
- `url`、`headers`、`body` 中的变量引用上游节点的 `structuredPayload` 字段。
- `headers` 中的 secret 通过 `SecretReference` 解析注入，不存 plaintext。
- 支持长任务轮询：当 `is_long_api` 为真时，按 `intervals` 间隔轮询结果，单次轮询受 `singleOvertime` 约束，整体受 `overtime` 总时长约束；轮询超时按失败处理并进入节点失败优先级链。
- 长任务轮询期间接收 `AbortSignal` 立即停止，不得继续后续轮询。

**python**

- 通过 sandbox gateway 执行 Python 脚本。
- `nodeConfig`：`script` 或 `scriptRef`（引用上游变量中的脚本内容）、`timeoutMs`。
- 执行结果包含 `stdout`、`stderr`、`exitCode`。

**agent**

- 通过 `CapabilityInvocationService` 调用子 Agent。
- `nodeConfig`：`agentId`、`task`（可引用上游变量）。
- 子 Agent 作为 capability 的一种类型（`CapabilityKind.AGENT`），走标准调用路径。

实现约束：
- `tool` 节点调用的 tool 必须已通过 capability governance 校验为 `AVAILABLE`。
- `python` 节点必须走 sandbox gateway——不得直接使用 `child_process` 或宿主进程权限。
- `restful` 节点的 secret 通过 `SecretReference` 解析后注入 HTTP header/body，raw secret 不进入 `nodeConfig`、日志、`WorkflowNodeResult` 或 safe error。
- `agent` 节点的子 Agent 执行结果不得污染父 recipe context 的 `agentId` 和 `identityContext`。
- 所有 capability 调用接收 `AbortSignal`。
- 本 change 不得把 capability 节点私有配置或输出字段回写成 workflow 最小 contract 的公共字段。

非目标：
- `restful` 节点不支持 GraphQL、gRPC 或 WebSocket。
- `python` 节点不支持预装第三方库管理（使用 sandbox 默认环境）。
- `agent` 节点不支持远端 Agent 执行（仅本地）。

验收要点：
- integration test：`tool` 节点成功调用 tool 获取 `structuredPayload` — 首版暂不实现，延期
- integration test：`tool-choice` 从候选集中正确选择 tool，输出 `selectedToolId`。
- integration test：`python` 节点通过 sandbox 执行脚本，返回 stdout/stderr/exitCode。
- integration test：`restful` 节点成功发起 HTTP 请求，secret header 正确注入。
- integration test：`agent` 节点调用子 Agent 并正确映射返回结果。
- security test：`python` 节点尝试访问文件系统被 sandbox 拦截。
- security test：`restful` 节点的 `WorkflowNodeResult.structuredPayload` 不含 raw secret。

并行边界：
- 只注册新的节点类型 handler，不修改 engine 调度器核心。
- 复用 `CapabilityInvocationService` port，不新建第二套 capability 调用路径。
- 节点私有 schema owner 在本 change，不在 `add-ts-workflow-engine-contracts`。
