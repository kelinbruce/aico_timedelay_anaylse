# add-ts-todo-tool

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Tool

状态：candidate
类型：实施 change
主要 owner：`agent-capability`
依赖：`add-ts-builtin-tool-framework`、`add-ts-capability-core-governance`

## 变更概述

新增 builtin Tool：`Todo`。该工具用于复杂任务执行中的轻量级规划清单，让智能体可以记录、更新和完成代办项，并把当前计划状态以安全、结构化形式带入后续模型轮次。

`Todo` 只表达当前智能体执行计划，不创建后台任务、不调度 worker、不拥有 task lifecycle。后台任务创建、查询、停止、输出读取和更新仍由 `add-ts-task-tools` 的 Task tools 工具族承载。

## 规格输入

- Tool canonical id 固定为 `Todo`，`displayName` 同样为 `Todo`。
- 不定义 lowercase `todo` alias；如需 alias，必须先在 design 中说明兼容范围、冲突处理和验证方式。
- `Todo` 必须通过 `defineTool`、`ToolCatalog`、`BuiltinToolExecutor`、CapabilityInvocationPort 暴露和执行，不得建立并行 invocation path。
- 输入采用完整清单替换模型，避免 patch command、局部状态合并和幂等语义分叉。
- 输入 schema：

```json
{
  "items": [
    {
      "id": "short-stable-id",
      "content": "string",
      "status": "pending | in_progress | completed"
    }
  ]
}
```

- `items` 最多 20 条；空数组表示清空当前规划。
- `id` 只作为当前 todo list 内稳定引用，不作为安全身份或持久化 owner。
- 同一 list 内 `id` 必须唯一。
- `content` 是短文本，固定预算上限为 200 chars。
- `status` 只允许 `pending`、`in_progress`、`completed`。
- 同一 list 同一时刻最多一个 `in_progress`。
- 输入不得包含 tenant、subject、agent、owner、session、request、run、workspace path、credential、secret、raw prompt、raw model output 或任意 scope 覆盖字段。

输出 schema：

```json
{
  "todos": [
    {
      "id": "short-stable-id",
      "content": "string",
      "status": "pending | in_progress | completed"
    }
  ],
  "summary": {
    "total": 0,
    "pending": 0,
    "inProgress": 0,
    "completed": 0
  }
}
```

## 契约输入

- `Todo` state 必须绑定 trusted owner scope、agent scope、sessionId、requestId/runId。
- owner scope 和 agent scope 只能来自 runtime/capability invocation trusted context，不得来自 tool input、model output、client metadata 或 capability arguments。
- `Todo` 的持久化 owner 必须在 design 中明确：首选 request/run scoped planning state；如需 session scoped continuation，必须说明读取、覆盖、清空和恢复语义。
- `Todo` 结果进入 history/stream 时只暴露安全摘要和结构化清单，不得泄漏 raw prompt、raw model output、raw tool arguments、host path、secret、credential 或高基数字段。
- `Todo` 不得访问 task service，不得创建 `TaskCreate` 等后台任务事实，不得把 todo item 自动转换为 Task。
- 如果 recovery/retry 需要重放 `Todo` 调用，必须遵循 capability idempotency contract；在幂等语义未定义前不得声明 replay-safe。

## 状态

- 状态：candidate
- 类型：capability
- 主要 owner：Owner 9 Tool Capability

## 目标

新增一个 governed builtin `Todo` tool entry，用于模型在复杂任务中维护当前规划清单，并支持创建、更新状态、标记完成和清空计划。完成后，模型可通过后续上下文看到当前 todo list 的安全结构化投影。

## 后续 OpenSpec artifact

- 后续创建 OpenSpec change：`openspec/changes/add-ts-todo-tool/`
- 后续新增 delta spec：`openspec/changes/add-ts-todo-tool/specs/todo-tool/spec.md`
- 如需持久化 planning state，补充对应 gateway/local store design；否则明确首版只使用 request/run scoped state。

## 非目标

- 不实现后台任务 runtime、任务调度、worker、cron 或周期任务。
- 不替代 `TaskCreate`、`TaskGet`、`TaskList`、`TaskOutput`、`TaskStop`、`TaskUpdate`。
- 不定义 Web UI 专用事件或前端交互。
- 不做跨会话长期记忆，不把 todo 自动写入 memory。
- 不允许用户或模型通过 tool input 覆盖 owner scope、agent scope、sessionId、requestId 或 runId。
- 不定义通用 checklist、项目管理或多人协作任务系统。

## 验收要点

- schema tests 覆盖创建清单、更新状态、标记完成、清空清单、空内容、超长内容、重复 id、非法 status、超过 20 条和多个 `in_progress`。
- integration tests 覆盖模型调用 `Todo` 后通过既有 capability boundary 执行，并在后续模型轮次看到安全结构化 todo result。
- security tests 覆盖 tool-supplied scope 字段被拒绝或忽略，且不能影响 trusted owner/agent scope。
- architecture tests 覆盖 `Todo` 不直接访问 task service、不拥有 task lifecycle、不绕过 `ToolCatalog` / `BuiltinToolExecutor`。
- safe projection tests 覆盖 stream/history/log/audit 不暴露 raw tool args、raw prompt、raw model output、host path、secret 或 credential。
