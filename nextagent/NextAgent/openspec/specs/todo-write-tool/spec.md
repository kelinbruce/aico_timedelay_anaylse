# todo-write-tool Specification

## Purpose

Define the TodoWrite builtin Tool behavior, scoped todo state persistence, context projection, terminal guard and safe observability requirements.
## Requirements
### Requirement: TodoWrite exposes a scoped todo-list Tool

系统 SHALL 暴露 `TodoWrite` 作为 built-in Tool capability。它的 canonical model/tool/capability id SHALL 为 `TodoWrite`，display name SHALL 为 `TodoWrite`，provider SHALL 为 `{ providerId: "builtin-tools", providerKind: "BUNDLED" }`。在同一 trusted app composition 下，`TodoWrite` 与同类别 `Task*` planning Tool family SHALL 保持 model-visible 互斥，系统一次只暴露其中一族给模型。`TodoWrite` 只维护当前请求执行上下文中的结构化进度清单，MUST NOT 创建后台任务、工作流任务、跨会话项目管理数据、pending input、审批请求或调度队列。

#### Scenario: Descriptor is exposed as a bundled Tool

- **WHEN** capability catalog 暴露内置 Tool descriptor
- **THEN** catalog MUST 包含 `kind="TOOL"`、`capabilityId="TodoWrite"`、`displayName="TodoWrite"`、`provider.providerId="builtin-tools"` 和 `provider.providerKind="BUNDLED"` 的 descriptor
- **AND** context rendering MUST 以精确名称 `TodoWrite` 向模型披露该 tool
- **AND** provider adapter MUST NOT 将 tool name 改写为 `todo_write`、`Todo`、`TaskUpdate`、`TaskCreate` 或其他别名。

#### Scenario: TodoWrite is not a task scheduler

- **WHEN** 模型调用 `TodoWrite`
- **THEN** 系统 MUST 只更新当前 trusted scope 的 todo list state
- **AND** MUST NOT 创建 runtime pending input、workflow task、background job、approval request、timer、external ticket 或跨会话任务记录。

### Requirement: TodoWrite input is a bounded full-list schema

`TodoWrite` input SHALL 只包含 required `todos` 数组。`todos` SHALL 允许 0 到 100 个 item。每个 item SHALL 只包含 required `content`、`activeForm` 和 `status` 字段；`content` 与 `activeForm` SHALL 为 1 到 500 个 Unicode scalar value 的字符串；`status` SHALL 只允许 `pending`、`in_progress` 或 `completed`。无效输入 MUST 在状态写入前失败，并且 MUST NOT 部分写入。`todos` 表示完整的新列表；模型新增 item 时 MUST 提交包含现有未完成 item 和新增 item 的完整有序列表，而不是只提交增量 patch。

#### Scenario: Valid input is accepted

- **WHEN** 模型调用 `TodoWrite` 且 `todos` 数组内每个 item 都包含合法 `content`、`activeForm` 和 `status`
- **THEN** 系统 MUST 接受该输入进入 todo update 流程
- **AND** MUST 保留每个 item 的顺序。

#### Scenario: Invalid item shape is rejected

- **WHEN** 模型调用 `TodoWrite` 且任一 item 缺少 `content`、`activeForm` 或 `status`，包含额外字段，或 `status` 不属于 `pending`、`in_progress`、`completed`
- **THEN** 系统 MUST 返回 safe `INVALID_INPUT` validation outcome
- **AND** MUST NOT 修改当前 todo list state。

#### Scenario: Text and list budgets are enforced

- **WHEN** 模型调用 `TodoWrite` 且 `todos` 超过 100 个 item，或任一 `content` / `activeForm` 为空字符串或超过 500 个 Unicode scalar value
- **THEN** 系统 MUST 返回 safe `INVALID_INPUT` validation outcome
- **AND** MUST NOT 截断、裁剪、改写或部分写入该 todo list。

### Requirement: TodoWrite replaces the current list atomically

`TodoWrite` SHALL 是全量替换操作。每个首次出现的 trusted invocation MUST 追加一条当前 trusted scope 内的 todo revision，并用输入 `todos` 表示的新列表替换 current projection。输入数组为空时，系统 MUST 追加空 revision 并清空当前列表。输入数组非空且所有 item 的 `status` 均为 `completed` 时，系统 MUST 追加空 revision，并清空对 channel/UI 暴露的当前列表，避免已完成清单长期停留。同一 trusted invocation 的重复执行 MUST 返回首次 revision 的结果，MUST NOT 追加重复 revision，MUST NOT 再次修改 current projection。

#### Scenario: New list replaces existing list

- **WHEN** 当前 trusted scope 已有 todo list
- **AND** 模型调用 `TodoWrite` 提交一个合法且不全为 `completed` 的 `todos` 数组
- **THEN** 系统 MUST 用提交的 `todos` 完整替换旧列表
- **AND** 旧列表中不存在于新数组的 item MUST 不再出现在当前 projection 中。

#### Scenario: Empty input clears the list

- **WHEN** 当前 trusted scope 已有 todo list
- **AND** 模型调用 `TodoWrite` 且 `todos=[]`
- **THEN** 系统 MUST 清空当前 todo list state
- **AND** 当前 projection MUST 显示为空列表。

#### Scenario: All completed input clears stored projection

- **WHEN** 模型调用 `TodoWrite` 且 `todos` 非空，并且所有 item 的 `status` 都是 `completed`
- **THEN** 系统 MUST 将当前 trusted scope 的 stored todo list 设置为空列表
- **AND** channel/UI projection MUST 不再显示这些已完成 item
- **AND** 成功 result 中的 `newTodos` MUST 为空列表。

#### Scenario: Multiple writes in one session append ordered revisions

- **WHEN** 同一 owner/agent/session scope 内连续成功调用 `TodoWrite` 多次
- **THEN** 系统 MUST 为每次成功调用追加一条 revision
- **AND** revision sequence MUST 在该 owner/agent/session scope 内单调递增
- **AND** current projection MUST 等于最新 revision 的 `todos`
- **AND** 历史 revision MUST 保留每次调用后的完整 todo snapshot。

#### Scenario: Repeated invocation is idempotent

- **WHEN** 同一 owner/agent/session/request/run/context/tool-call 坐标下重复执行同一个 `TodoWrite` invocation
- **THEN** 系统 MUST 返回首次 invocation 的 `oldTodos`、`newTodos` 和 revision
- **AND** revision history MUST NOT 追加第二条 revision
- **AND** current projection MUST NOT 因重复执行再次变化。

#### Scenario: Stateless app instances share persisted current state

- **WHEN** 一个 NextAgent 实例成功调用 `TodoWrite`
- **AND** 另一个 NextAgent 实例连接同一个 gateway backend 并读取同一 owner/agent/session scope
- **THEN** 第二个实例 MUST 读取到第一个实例写入的最新 current projection
- **AND** 进程重启 MUST NOT 丢失未完成 todo revision history 或 current projection。

### Requirement: TodoWrite state is isolated by trusted execution scope

`TodoWrite` state SHALL 按 trusted runtime/capability execution context 隔离。scope identity MUST 来自当前 accepted session、request run、agent 或等价可信执行事实；模型输入、client metadata、tool arguments 或 provider-private metadata MUST NOT 提供、覆盖或扩展 todo scope。

#### Scenario: Agent scope isolation is enforced

- **WHEN** 两个不同 agent scope 在同一 owner/session 下调用 `TodoWrite`
- **THEN** 每个 agent scope MUST 只能读取和更新自己的 todo list state
- **AND** 一个 agent scope 的 update MUST NOT 覆盖另一个 agent scope 的 todo list projection。

#### Scenario: Tool input cannot override scope

- **WHEN** 模型在 `TodoWrite` input 中提供 `sessionId`、`agentId`、`runId`、`owner`、`scope` 或其他身份字段
- **THEN** 系统 MUST 按 schema 拒绝该输入为 `INVALID_INPUT`
- **AND** MUST NOT 使用这些字段决定 todo state ownership。

### Requirement: TodoWrite returns safe structured results

成功的 `TodoWrite` invocation SHALL 返回 safe structured payload，至少包含调用前的 `oldTodos` 和本次成功写入后的 `newTodos`。`oldTodos` 与 `newTodos` MUST 只包含合法 todo item 字段。失败结果 MUST 使用 safe reason code，且 MUST NOT 暴露 hidden prompt、raw model context、provider-private facts、host path、credential、token、tenant secret 或未授权 scope 信息。

#### Scenario: Successful result contains old and resulting todo lists

- **WHEN** `TodoWrite` 成功处理合法输入
- **THEN** result structured payload MUST 包含调用前当前 trusted scope 的 `oldTodos`
- **AND** MUST 包含本次写入后的当前 `newTodos`
- **AND** 每个 result todo item MUST 只包含 `content`、`activeForm` 和 `status`。

#### Scenario: Failure result is safe

- **WHEN** `TodoWrite` 因 invalid input、state store unavailable、aborted 或 unexpected execution failure 不能完成
- **THEN** 系统 MUST 返回 safe failure result
- **AND** failure result、日志、审计、trace 和 metric MUST NOT 包含 raw hidden context、credential、token、provider-private metadata 或其他 scope 的 todo list 内容。

### Requirement: TodoWrite state is restored into model context

`TodoWrite` current state SHALL be restored into each same-scope model context from checkpoint-backed request context (`flowVariables.todoWriteState`). This projection SHALL be derived only from trusted runtime/capability execution context. Conversation history, ordinary `CAPABILITY_RESULT` messages, and context compression summaries MAY mention TodoWrite results, but they MUST NOT be the only source of current todo state.

#### Scenario: Current todos are visible in the next model context

- **WHEN** `TodoWrite` writes a non-empty current list
- **AND** the same request context or a recovered checkpoint-backed request context assembles a later model context
- **THEN** the assembled context MUST include a bounded current TodoWrite state projection containing the current unfinished items
- **AND** the projection MUST come from trusted request context restored by checkpoint, not from model-provided scope fields.

#### Scenario: Context compression does not lose current todos

- **WHEN** previous conversation messages have been compressed or omitted by context assembly
- **AND** current TodoWrite state still contains unfinished items
- **THEN** the next assembled context MUST still include the current TodoWrite state projection.

### Requirement: TodoWrite unfinished state gates terminal completion

Before committing a successful terminal response, the agent loop SHALL check current TodoWrite state for the same trusted owner/agent/session scope. If any item is `pending` or `in_progress`, the system MUST give the model one bounded follow-up opportunity to continue, complete/clear the list, or explicitly explain why terminal completion is acceptable with unfinished items. The guard MUST NOT create pending input, workflow tasks, approvals, or unbounded retry loops.

#### Scenario: Unfinished todos trigger one follow-up turn

- **WHEN** the model produces a final response
- **AND** current TodoWrite state contains one or more `pending` or `in_progress` items
- **THEN** the agent loop MUST NOT immediately commit terminal success
- **AND** it MUST invoke the model one additional time with a safe unfinished todo summary.

#### Scenario: Guard is bounded

- **WHEN** the follow-up turn still leaves unfinished TodoWrite items
- **THEN** the agent loop MAY commit the final response after the bounded guard has fired once
- **AND** MUST NOT loop forever solely because unfinished TodoWrite items remain.

### Requirement: TodoWrite observability is low-cardinality and non-sensitive

系统 SHALL 为 `TodoWrite` invocation 产生可追踪但低敏的观测事实。日志、审计、trace 和 metric MAY 包含 capability id、status、safe reason code、item count、各 status 计数、duration bucket 和 stable invocation id；MUST NOT 记录完整 todo 文本、hidden context、模型原始输入、身份覆盖字段、credential、token 或 provider-private facts。

#### Scenario: Gateway persistence is observed without todo text leakage

- **WHEN** `TodoWrite` persistence appends a revision, updates current state, clears current state, or fails
- **THEN** gateway diagnostics MAY include operation, success/failure outcome, revision sequence, old/new item counts, current projection action, safe error code/category, retryability, and duration bucket
- **AND** gateway diagnostics MUST NOT include full `content`, full `activeForm`, raw prompt/model output, credential, token, host path, or untrusted scope override fields.

#### Scenario: Invocation is observed without todo text leakage

- **WHEN** `TodoWrite` 成功或失败
- **THEN** observability output MUST 能按 invocation id 和 capability id 关联该调用
- **AND** MUST NOT 包含完整 `content` 或 `activeForm` 文本。

#### Scenario: TodoWrite observability is not owned by Tool metadata

- **WHEN** `TodoWrite` descriptor and Tool definition are loaded
- **THEN** its low-cardinality diagnostics MUST be derived by runtime/gateway/observability owners
- **AND** `TodoWrite` Tool metadata MUST NOT define a Tool-specific observability projector.
