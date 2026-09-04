## 背景与问题（Why）

本地运行时将普通 Bash 前台调用放入可后台化执行通道，以便超时后保留后台任务。后台进程正常结束后，`agent-app` 的 completion 回调错误地提交了 `bg-notify-*` 续跑请求。该请求与原请求处于同一 session lane，会按最新请求优先规则取消仍在继续执行的原请求，表现为第二轮模型调用 `MODEL_ABORTED` 和请求终态 `SUPERSEDED`，即使用户没有提交新请求。

后台任务自然完成的既有设计是静默记录任务终态和 timeline；只有用户显式 kill 后才允许提交通知续跑。实现与该边界不一致，必须修复。

## 变更范围（What Changes）

- 修正 `agent-app` 的后台完成回调：自然完成仅持久化任务状态并发出后台任务终态 timeline，不得调用 runtime submit。
- 保留 Web background-task kill 路径的 `bg-notify-*` 续跑行为。
- 增加回归测试：普通前台 Bash 成功完成后，原请求继续执行并完成，不会由内部后台完成通知替代。

## Capability 影响（Capabilities）

### 新增 Capability

- `background-task-completion`: 定义后台任务自然完成与显式 kill 后的 Agent 续跑边界。

### 修改的 Capability

无。

## 影响范围（Impact）

- `packages/agent-app/src/composition/create-app.ts` 的本地 capability composition。
- 后台 Bash 执行、same-session lane 以及模型调用连续性。
- `agent-app` 集成测试；不改变 Web API、配置格式或模型提供方配置。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/background-task-completion/spec.md`：新增自然完成和显式 kill 的通知边界。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/request-lifecycle.md`：无。
- `openspec/designs/modules/agent-app.md`：更新后台完成回调不提交续跑请求的 composition 边界。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：若新增或修改模块设计导航则更新。

验证入口：
- `agent-app` 后台任务 completion 集成测试。
- `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`。
