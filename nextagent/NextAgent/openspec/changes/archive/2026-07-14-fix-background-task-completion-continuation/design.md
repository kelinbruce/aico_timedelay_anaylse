## 背景和现状（Context）

`agent-capability` 为本地 Bash 提供可后台化执行：即使前台命令在超时前完成，也会创建后台任务记录并调用 `onBackgroundComplete`。`agent-app` 当前回调先记录完成状态，又对同一任务调用 `RuntimeCommandPort.submit`。这与完成回调的静默设计冲突，并使内部 `bg-notify-*` 请求替代同一 session 中尚未完成的原请求。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 自然完成仅记录后台任务终态和 timeline，原请求继续消费工具结果。
- 保留用户显式 kill 后的幂等通知续跑。

**非目标：**
- 不修改 same-session latest-request 调度语义。
- 不改变后台任务 Web API、持久化 schema、模型调用或 cron 触发行为。
- 不为自然完成新增通知配置开关。

## 设计决策（Decisions）

唯一实现路径是让 `agent-app` 的 `onBackgroundComplete` 只委托 `buildBackgroundCompletionCallback`，移除随后读取 task 并调用 `backgroundExecutionRuntime.submit(buildTaskNotificationCommand(...))` 的分支。完成 callback 已负责 `markCompleted` 和 `BACKGROUND_TASK_COMPLETED`/`BACKGROUND_TASK_FAILED` timeline event；不应同时承担 Agent 续跑职责。

`buildTaskNotificationCommand` 和 channel composition 中的 kill 路径保持不变。该路径由受信任 Web kill 操作触发，且以 `bg-notify-<taskId>` 锚定幂等性。没有采用在 runtime lane 中识别并忽略完成通知的方案，因为错误来源属于 app composition，修改调度规则会扩大影响面并掩盖其他内部 submit 缺陷。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 不新增客户端输入或权限边界；自然完成不再伪造 USER 请求。 | 后台任务集成测试和代码审查。 |
| 性能/容量 | 删除一次无效模型续跑与持久化请求，降低每个普通 Bash 完成后的额外负载。 | 集成测试断言没有额外 run。 |
| 可靠性/恢复 | 原 run 不再被内部请求 supersede；任务终态仍由既有 completion callback 持久化。 | 自然完成回归测试。 |
| 可维护性 | completion callback 只承担一个职责，显式 kill 续跑继续由 channel composition owning path 承担。 | 代码审查和架构检查。 |
| 可测试性 | 使用已存在的可控 `BackgroundStartResult.completion` 测试替身，稳定复现自然完成。 | `background-tasks-endpoint.test.ts`。 |
| 审计/可追溯性 | 保留后台任务 terminal timeline；消除误导性的内部 USER 消息和错误 superseded terminal。 | timeline/run 状态断言。 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 自然完成不得创建续跑请求 | 1.1, 2.1 | 后台任务集成测试断言单一 RequestRun 和原 run COMPLETED。 |
| 显式 kill 仍允许通知续跑 | 2.2 | 既有 kill 集成测试。 |
| 完成状态和 timeline 保持 | 2.1 | 后台任务集成测试断言 completed task。 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/background-task-completion/spec.md`。
- 架构和跨模块设计：无。
- 模块设计：`openspec/designs/modules/agent-app.md` 记录 completion composition 不提交自然完成续跑请求。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md` 按新增 stable spec 和模块设计更新。

## 风险与取舍（Risks / Trade-offs）

- [依赖自然完成通知的未显式调用方失去一次模型续跑] -> 该行为与现有静默完成设计相悖，且自然完成结果已进入原请求的工具结果和 timeline；保留 kill 续跑满足用户显式操作的通知需求。
- [异步 completion 与原请求工具结果写入并发] -> 不再提交第二个 run，消除 lane 替代；既有 task 状态写入保持幂等。

## 迁移计划（Migration Plan）

无数据迁移。发布后新自然完成任务不再生成 `bg-notify-*` 请求；历史记录保持不变。回滚为恢复单一 callback 分支，但不建议在没有更新行为规格的情况下执行。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/background-task-completion/spec.md`：提炼完成通知边界。
- `openspec/overview.md`：无。
- `openspec/designs/modules/agent-app.md`：提炼 app composition 对自然完成和 kill 的职责边界。
- `openspec/designs/architecture/<topic>.md`：无。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：新增导航和验证入口。

## 待确认问题（Open Questions）

无。
