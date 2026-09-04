## 背景和现状（Context）

NextAgent 已经拥有统一的内置 Tool 框架：Tool 通过
`defineTool` 定义、经自有内置 Tool 列表注册、由
`ToolCatalog` 投影，并通过 capability 调用路径由
`BuiltinToolExecutor` 执行。文件类 Tool 使用 `workspaceFiles` 等
受控依赖；Tool 不得直接依赖 runtime、channel、app 或
宿主实现细节。

当前 TodoWrite 分支引入了模型可见的 `TodoWrite` tool，但其
第一版实现把 todo 状态保存在 runtime 内存 map 中。这对
无状态多实例部署不可接受：第二个实例、一次重启或一次
failover 都会丢失当前 session 的进度列表。

## 目标（Goals）

- 新增 canonical 内置 Tool `TodoWrite`，名称精确为 `TodoWrite`。
- 使用 `todos[]` 作为当前 todo 列表的全量替换。
- 输入为空或所有条目均为 `completed` 时清空当前列表。
- 所有 todo 状态都由可信 owner scope、agent scope 和 session 划定范围。
- 通过 gateway 边界持久化当前 todo 状态，使 NextAgent app
  实例保持无状态。
- 让同一可信 TodoWrite 调用的重复执行保持幂等：
  重试必须返回首次持久化的 revision 结果，不追加
  重复 revision。
- 把当前未完成 todo 列表投影到每个 model context，数据来自
  通过既有 checkpoint `flowVariables` 恢复的 request-local 内存。
- 在仍有未完成 todo 条目时，通过给模型一个有界的后续
  回合来对齐进度或显式清空列表，
  防止静默 terminal completion。
- 保持 TodoWrite 结果和 observability 安全；完整 todo 文本不得被记录
  到日志、trace 或作为 audit 属性发出。

## 非目标（Non-Goals）

- 不创建 workflow task、pending input、审批、定时作业、
  工单或跨 session 的项目管理记录。
- 不在同一个 app composition 中同时暴露 `TodoWrite` 和同类 `Task*` 规划
  Tool；模型可见的规划 Tool 家族在可信系统配置下保持
  互斥。
- 不新增 TodoWrite 专用 Web API 或 channel 自有的写状态机。
- 本 change 不支持同一 session todo 列表的协作式合并语义或
  CAS 编辑。

## 设计决策（Decisions）

### D1: 复用内置 Tool 路径

`TodoWrite` 位于 `packages/agent-capability/src/builtins/todo-write/`。
descriptor 由既有 catalog 投影，执行走标准内置
Tool executor。Agent core 和 runtime 不引入
TodoWrite 专用 invocation request 或硬编码分支。

否决的备选方案：在 agent core 中硬编码 TodoWrite。那会复制
Tool executor 路径，并把普通 Tool 语义塞进 core 编排。

### D2: 把 `todoState` 保持为唯一的 Tool 侧状态边界

`ToolDependencyName` 和 `ToolDependencies` 包含受控的 `todoState`。
`TodoWrite` 声明 `requiredDependencies: ["todoState"]`；如果 app composition
未提供它，descriptor 不可用且执行被阻断。

Tool 侧依赖只暴露一个原子操作：

```text
replaceTodos(input: { todos: TodoItem[] }, context: ToolExecutionContext, signal?: AbortSignal)
  -> { oldTodos: TodoItem[], newTodos: TodoItem[] }
```

`TodoWrite` 校验输入并在调用依赖前归一化空输入/全部完成输入。
scope 只从可信 `ToolExecutionContext` 派生：
`identityContext.tenantId`、`identityContext.subjectId`、`agentId` 和
`sessionId`。`runId`、`requestId`、`requestContextId` 和 `toolCallId` 构成
调用幂等锚点，不参与归属。

### D3: 每次 TodoWrite 调用持久化为一个 revision 并维护当前状态

默认 app composition 注入 runtime 拥有的 adapter，但该 adapter 是
无状态的。它委托给 `TodoStateStoreGateway`，一个拥有
持久化 record 的 gateway contract：

```text
TodoStateRecord = OwnerScoped + agentId + sessionId + todos + updatedAt
```

本地 SQLite gateway 存储两个专用事实：

- `todo_state_revisions`：append-only 行，按
  (tenant_id, subject_id, agent_id, session_id, revision_seq) 作为键。每行是一次
  成功的 `TodoWrite` 调用，保存结果的全量 todo 快照。
- `todo_states_current`：每个 (tenant_id, subject_id, agent_id,
  session_id) 一行，包含最新结果快照和最新
  `revision_seq`。

首次出现的非空替换追加一个 revision 并 upsert 当前状态。
首次出现的空替换追加一个空 revision 并删除当前
状态。两条路径都返回之前的当前列表、结果当前列表
和新的 revision 序号。

追加前，gateway 检查同一可信调用坐标下是否已存在
revision：

```text
tenant_id + subject_id + agent_id + session_id
+ request_id + request_run_id + request_context_id + tool_call_id
```

如果存在匹配的 revision，gateway 把该 revision 作为幂等结果返回，
不追加另一个 revision，也不改变当前状态。
幂等 replay 返回的旧列表从同一 owner/agent/session scope 的
前一个 revision 重建，因此重复调用观察到与首次调用相同的
`{ oldTodos, newTodos }`。

因此连接到同一 gateway 后端的多个 NextAgent 实例
共享同一 session/agent todo 状态。进程重启不得丢失
未完成的 todo 列表。

否决的备选方案：把 runtime 内存 `Map` 作为默认状态。它把
状态绑定到单个进程，破坏无状态多实例部署。

### D4: 返回写入后的当前列表

成功的 structured payload 是 `{ oldTodos, newTodos }`。`oldTodos` 是
替换前的列表；`newTodos` 是写入后归一化持久化的
列表。当每个输入条目都已完成时，`newTodos` 为 `[]`。

### D5: 使用 `IDEMPOTENT` replay policy 并由 gateway 持有调用锚点

TodoWrite descriptor 使用 `replayPolicy: "IDEMPOTENT"` 的唯一原因是 gateway
拥有稳定的调用锚点。启动恢复只有在能重建同一
可信调用坐标时才允许 replay 一个调用。此时 gateway
返回已持久化的 revision 结果，而不是重复
写入 side effect。

### D6: 从 checkpoint 支撑的 context 投影当前 todo 状态

`TodoWrite` 状态不只是历史 `CAPABILITY_RESULT`。当前
未完成列表也是一个 request-context 事实。成功追加 TodoWrite
结果后，runtime 更新 `context.flowVariables.todoWriteState` 并
保存既有 `CAPABILITY_AFTER_RETURN` checkpoint。恢复时从
checkpoint 恢复同一 flow variable，下一次 model render 把它投影为
有界的模型可见进度块。

该投影从可信 runtime scope 派生，而不是从模型参数
或 channel metadata 派生。上下文压缩可以总结先前对话，
但不得成为 todo 进度的唯一来源。不引入额外的
context 专用 store。

### D7: 在 todo 未完成时守卫 terminal completion

terminal commit 前，runtime/core 检查当前 todo 投影。如果任何
条目是 `pending` 或 `in_progress`，模型收到一个有界的后续
回合，其中描述未完成条目数量，并要求它要么继续工作、
清空/完成 todo 列表，要么显式解释为什么可以带着
未完成条目结束。该守卫有界以避免无限循环，不会
创建 pending input、workflow task 或审批。

### D8: 把 observability ownership 保留在 Tool 定义之外

TodoWrite 不得依赖 `defineTool.observability` 来定义 observability
语义。Tool 定义拥有模型可见 descriptor、schema、依赖
和执行。Runtime/gateway/observability owner 从安全结果
形态和已持久化的 gateway 事实派生低基数诊断。既有 RAG
observability 债务不因本 change 扩大。

## 质量属性设计（Quality Attributes）

| 属性 | 设计决策 | 验证 |
|---|---|---|
| 安全 | scope 只来自可信执行上下文；schema 拒绝身份字段；runtime 和 gateway observability 不记录完整 todo 文本 | schema negative test、scope 隔离测试、observability 测试 |
| 容量 | 最多 100 项；每个 `content` 和 `activeForm` 最多 500 个 Unicode scalar 值 | schema 测试 |
| 可靠性 | 当前 todo 状态按 gateway session/agent scope 持久化，并通过 checkpoint flowVariables 恢复到 request context | SQLite 持久化测试、checkpoint/context 测试 |
| 可维护性 | 复用 Tool dependency 和 gateway-store 模式；core/channel 无特例 | architecture 测试 |
| 恢复 | 调用级幂等允许安全 retry/recovery 且不产生重复 revision | recovery replay 守卫和 SQLite 幂等测试 |
| 上下文连续性 | 当前 todo 状态从 checkpoint 支撑的 request context 投影到每次同 scope model render | agent-core context 投影测试 |
| 终态正确性 | 未完成 todo 守卫在 terminal commit 前给模型一次有界的进度对齐机会 | agent-kernel 测试 |

## 验证映射（Verification Map）

| 约束 | Task | 验证 |
|---|---|---|
| descriptor canonical 名称和内置 provider | 1.3 | descriptor 测试、model rendering 测试 |
| 输入 schema 和预算 | 1.2 | `todo-write-schemas.test.ts` |
| 全量替换和清空语义 | 2.2, 2.3 | capability 测试、gateway todo state 测试 |
| 无状态多实例持久化、每 session 多个 revision 和幂等 replay | 2.1, 2.5, 2.6 | 使用两个 store 实例的 SQLite gateway 测试 |
| scope 只来自可信上下文 | 2.4 | 跨 session/跨 Agent 隔离测试 |
| 不含 Tool 自有 observability 元数据的低基数 gateway 持久化诊断 | 3.2, 3.5 | SQLite gateway 日志脱敏和 architecture 测试 |
| todo context 投影和压缩恢复 | 3.6 | agent-core checkpoint/context 投影测试 |
| 未完成 todo terminal 守卫 | 3.7 | agent-kernel 测试 |
| 缺失依赖时不可用 | 1.4 | catalog 依赖测试 |
| 无 core/runtime/channel 私有路径 | 3.3 | architecture 测试、`npm run lint:architecture` |
| OpenSpec 有效性 | 4.1 | `openspec validate add-ts-todowrite-tool --strict` |

## 文档承载决策（Documentation Ownership）

- `openspec/specs/todo-write-tool/spec.md` 拥有 TodoWrite 行为、schema、
  替换语义、清空语义、状态持久化、scope 隔离
  和 safe result 要求。
- `openspec/specs/builtin-tool-framework/spec.md` 拥有作为受控
  Tool 依赖的 `todoState`。
- `agent-contracts/gateway` 拥有 TodoWrite 持久化 DTO 和
  `TodoStateStoreGateway` port。
- `agent-platform-gateway-local` 拥有 SQLite `todo_state_revisions` 和
  `todo_states_current` 表及 row mapping。
- `agent-runtime` 拥有从 Tool 执行上下文到
  gateway port 的无状态 adapter。
- `agent-core` 拥有从 checkpoint 支撑的 `flowVariables`
  进行的 request-local TodoWrite context 投影，以及有界 terminal
  守卫编排。
- `agent-app` 拥有依赖注入。

## 风险与取舍（Risks / Trade-offs）

- 同一 owner/agent/session scope 内的并发调用使用 last-writer-wins 的
  全量替换。这是可接受的，因为 TodoWrite 是当前进度
  投影，而不是协作式任务编辑器。CAS/merge 语义需要
  单独的 OpenSpec change。
- 完整 todo 文本会持久化在 gateway 存储中并在 capability
  结果中返回，但不得写入日志、metric、trace 或 audit 事实。

## 迁移计划（Migration Plan）

本地 SQLite gateway 初始化会创建 `todo_state_revisions` 和
`todo_states_current`。没有这些表的既有部署会在启动时创建
它们。回滚可能留下未使用的行；当 TodoWrite 未注册或
`todoState` 未注入时会忽略这些行。

## 归档前更新基线（Baseline Promotion Plan）

- 新增 `openspec/specs/todo-write-tool/spec.md`。
- 更新 `openspec/specs/builtin-tool-framework/spec.md`，加入受控
  `todoState` 依赖。
- 更新 `agent-contracts`、`agent-platform-gateway-local`、
  `agent-runtime`、`agent-capability` 和 `agent-app` 的模块文档。
- 更新 `openspec/designs/spec-to-design-map.md`。

## 待确认问题（Open Questions）

无。
