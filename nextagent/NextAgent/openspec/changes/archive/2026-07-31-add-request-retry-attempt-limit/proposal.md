## 背景与问题（Why）

当前 request retry 能力（`openspec/specs/request-retry/spec.md`）只约束 retry 的合法性边界（latest、terminal、幂等、scope），没有次数上限：用户可以对同一个 request 无限次点击重试，每次都创建新的 `RequestRun` attempt 并真实消耗模型与算力资源。对电信网络运维场景而言，这带来两个实际问题：

- **成本与容量失控**：恶意或误操作的高频 retry 会放大模型调用和下游网管系统查询压力，缺少防滥用闸门。
- **治理语义缺失**：电信级质量要求容量与可审计性，retry 作为用户可见的高成本操作，必须有确定性的次数约束和可验证的拒绝行为。

业界常见做法是对单条回答的重新生成限制 3–5 次，由服务端权威计数、客户端只做投影。本 change 按此模式为 request retry 引入固定上限。

## 变更范围（What Changes）

- `agent-runtime` 在 retry acceptance 路径新增次数上限校验：每个 request 最多 5 次 retry（原始 attempt 1 + 至多 5 次重试，即最高 attempt 为 6）；当 source attempt 已达 6 时拒绝创建新 attempt。
- 超限拒绝使用新的稳定安全错误码 `REQUEST_RETRY_LIMIT_EXCEEDED`，category `CONFLICT`，`retryable=false`，不创建 attempt、不修改 history visibility、不触发 scheduler。
- 计数锚点为 durable `RequestRun.attempt`：凡被 accepted 的 retry（无论终态成败）都占次数；acceptance 阶段被拒绝的 retry（幂等重放、stale latest、非 terminal、超限）不创建 attempt，不占次数。已 accepted retry 的幂等重放仍返回首次结果，不受上限影响。
- `agent-channel-web` 透传该安全错误；`frontend/agent-web` 在收到超限错误后禁用该 turn 的全部 retry 按钮入口（TurnBlock、Composer），禁用态包含禁用光标 `not-allowed`、降低透明度和悬浮 Tooltip 原因说明，`/retry` slash 命令在触发后展示同一提示；前端在实时路径已知当前 attempt 达上限时也禁用按钮。前端不自行计数作为权威判断，权威限制永远在 runtime。
- 上限为固定常量 5，不引入配置项。

## Capability 影响（Capabilities）

### 新增 Capability

（无）

### 修改的 Capability

- `request-retry`: 新增 retry attempt 次数上限行为契约（上限数值、计数锚点、超限安全错误、幂等重放优先级、Web 投影行为）。

## 影响范围（Impact）

- 代码：`packages/agent-runtime`（retry acceptance 校验）、`packages/agent-channel-web`（安全错误透传，预期无需改动，仅需验证）、`frontend/agent-web`（retry 按钮禁用状态与提示）。
- API：`POST /api/v1/sessions/:sessionId/retry` 新增一种安全错误响应；无 schema 变更。
- 测试：`agent-runtime` retry 上限 characterization/contract 测试、负例断言（超限拒绝无 side effect、幂等重放优先、失败 attempt 占次数）、agent-web 按钮禁用与提示测试。
- 配置/运维：无新增配置；超限拒绝可通过既有 runtime 日志与 safe error code 观测。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- openspec/specs/request-retry/spec.md：新增「Retry attempt 次数上限」requirement（由本 change delta 归档合并）。

长期背景：
- openspec/overview.md：在稳定基线描述中为 request retry 补充「最多 5 次重试上限」一句。

设计视图：
- openspec/designs/architecture/request-run.md：补充 retry attempt 上限常量、计数锚点和超限拒绝语义。
- openspec/designs/modules/agent-runtime.md：无（retry acceptance 职责不变）。
- openspec/designs/adr/<id>.md：无。
- openspec/designs/spec-to-design-map.md：无（request-retry 导航已存在）。

验证入口：
- `npm test -- ...agent-runtime` retry 上限测试、`npm run test:contract`、`frontend/agent-web` 相关 `npm test` 与 `npm run build`。
