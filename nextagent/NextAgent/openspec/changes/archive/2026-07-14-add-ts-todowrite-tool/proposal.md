## 背景与问题（Why）

NextAgent 已有内置 Tool 框架、文件 Tool、检索 Tool 和
人工 pending-input Tool，但还没有模型可调用的结构化
进度列表。电信 Agent 常处理多步骤诊断、配置
检查、变更分析或报告生成。模型需要一种受治理的
方式发布当前进度，而不是写临时自由文本或私有 UI
状态。

本 change 新增内置 Tool capability `TodoWrite`。每次成功
调用提交一份完整 todo 列表，在可信 owner/agent/session
scope 内追加一个 todo-state revision，并更新当前投影。空
输入或全部完成的输入追加一个空 revision 并清空当前
投影。

## 变更范围（What Changes）

- 为 `TodoWrite` 新增 canonical 内置 Tool descriptor、输入 schema、输出 schema 和 safe
  result。
- 定义 todo 条目 schema：`content`、`activeForm` 和 `status`，其中 status
  只能是 `pending`、`in_progress` 或 `completed`。
- 把 `TodoWrite` 定义为全列表替换：每次成功调用创建一个
  有序 session revision，并用该 revision 归一化后的
  `todos[]` 替换当前投影。
- 通过 gateway 边界持久化 todo 事实：
  `todo_state_revisions` 存储每次成功调用，且
  `todo_states_current` 存储最新投影用于快速读取。
- todo state 的 scope 只来自可信 runtime/capability 执行上下文：
  owner scope + agent id + session id。模型输入不能覆盖 scope。
- 不把 `TodoWrite` 纳入后台任务、workflow 作业、审批、pending
  input、调度器、工单和跨 session 项目管理数据。
- 新增可信 app 配置开关
  `nextAgent.system.planning-tool-calling-mode`，在给定 app
  composition 中只向模型暴露 `TodoWrite` 或 `Task*` 内置 Tool
  家族之一，永不两者同时。默认值仍为 `todo-write`。
- 保持 observability 安全：日志、audit、trace 和 metric 可以包含计数、
  状态摘要、capability id、revision 序号、safe reason 和时长
  分桶，但不包含完整 todo 文本。

## 影响范围（Impact）

- `agent-capability`：新增 `TodoWrite` Tool 定义、schema、descriptor
  和 executor 集成。
- `agent-contracts/gateway`：新增 TodoWrite 持久化 record 和
  `TodoStateStoreGateway`。
- `agent-platform-gateway-local`：新增 SQLite 表和 row mapping，用于
  revision 历史和当前投影。
- `agent-runtime`：提供从 Tool 执行上下文到
  gateway store 的无状态 adapter。
- `agent-app`：注入 gateway 支撑的 `todoState` 依赖。
- `agent-context-engine`：为模型渲染 canonical `TodoWrite` tool 名称和
  schema。
- `agent-channel-web`：保持只投影，不拥有 TodoWrite 写
  语义。

## 归档前基线提升计划（Baseline Promotion Plan）

- 新增 `openspec/specs/todo-write-tool/spec.md`，涵盖行为、schema、
  替换、revision、当前投影、持久化、scope 隔离和
  safe result 要求。
- 更新 `openspec/specs/builtin-tool-framework/spec.md`，加入受控
  `todoState` 依赖语义。
- 更新 `agent-contracts`、`agent-platform-gateway-local`、
  `agent-runtime`、`agent-capability` 和 `agent-app` 的模块文档。
- 更新 `openspec/designs/spec-to-design-map.md`。

## 验证（Verification）

- Schema/单元测试：todo 条目字段、status enum、空文本、列表大小和
  条目文本预算。
- Capability 测试：descriptor 注册、全量替换、全部完成清空、
  agent/session scope 隔离和 safe structured result。
- Gateway 持久化测试：同一 session 多次写入追加多个
  revision；第二个 gateway 实例能读取同一 SQLite 后端的当前
  投影和 revision 历史。
- Architecture 测试：TodoWrite 不新增公开的 Tool 专用 invocation
  协议、不绕过 capability executor、不依赖 channel/web 私有
  实现。
- `openspec validate add-ts-todowrite-tool --strict`。
